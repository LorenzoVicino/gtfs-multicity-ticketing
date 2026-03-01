import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const REQUIRED_FILES = ["agency.txt", "routes.txt", "stops.txt", "trips.txt", "stop_times.txt"];

const OPTIONAL_FILES = {
  "calendar.txt": [
    "service_id",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "start_date",
    "end_date"
  ],
  "fare_attributes.txt": [
    "fare_id",
    "price",
    "currency_type",
    "payment_method",
    "transfers",
    "transfer_duration"
  ]
};

const NORMALIZED_COLUMNS = {
  "agency.txt": ["agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang", "agency_phone"],
  "routes.txt": [
    "route_id",
    "agency_id",
    "route_short_name",
    "route_long_name",
    "route_type",
    "route_color",
    "route_text_color"
  ],
  "stops.txt": [
    "stop_id",
    "stop_code",
    "stop_name",
    "stop_lat",
    "stop_lon",
    "zone_id",
    "location_type",
    "parent_station",
    "wheelchair_boarding"
  ],
  "calendar.txt": OPTIONAL_FILES["calendar.txt"],
  "trips.txt": [
    "route_id",
    "service_id",
    "trip_id",
    "trip_headsign",
    "trip_short_name",
    "direction_id",
    "block_id",
    "wheelchair_accessible",
    "bikes_allowed"
  ],
  "stop_times.txt": [
    "trip_id",
    "arrival_time",
    "departure_time",
    "stop_id",
    "stop_sequence",
    "pickup_type",
    "drop_off_type",
    "shape_dist_traveled"
  ],
  "fare_attributes.txt": OPTIONAL_FILES["fare_attributes.txt"]
};

function resolveCommand(command) {
  if (process.platform === "win32" && command === "npm") {
    return "npm.cmd";
  }

  return command;
}

function spawnPromise(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveCommand(command), commandArgs, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `${command} failed with exit code ${code}`));
    });
  });
}

function toUnixPath(value) {
  return value.replace(/\\/g, "/");
}

async function findFeedFile(dir, targetLower) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === targetLower) {
      return path.join(dir, entry.name);
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const nested = await findFeedFile(path.join(dir, entry.name), targetLower);
    if (nested) {
      return nested;
    }
  }

  return null;
}

async function writeCsvFile(filePath, columns, rows) {
  const csv = stringify(rows, { header: true, columns });
  await fs.writeFile(filePath, csv, "utf8");
}

async function ensureOptionalFile(filePath, columns) {
  await writeCsvFile(filePath, columns, []);
}

async function normalizeCsv(inputPath, outputPath, columns) {
  const text = await fs.readFile(inputPath, "utf8");
  const records = parse(text, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true
  });

  const normalized = records.map((row) => {
    const next = {};
    for (const column of columns) {
      const value = row[column];
      next[column] = value == null ? "" : String(value);
    }
    return next;
  });

  await writeCsvFile(outputPath, columns, normalized);
}

async function cityExists(cityCode) {
  try {
    const { stdout } = await spawnPromise("docker", [
      "exec",
      "gtfs-postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "gtfs_ticketing",
      "-tAc",
      `SELECT 1 FROM transport.city WHERE city_code = '${cityCode}' LIMIT 1;`
    ]);

    return stdout.trim() === "1";
  } catch {
    return false;
  }
}

async function importZip({ zipPath, cityCode, cityName, serviceDate }) {
  const uploadsRoot = path.join(repoRoot, "data", "gtfs", "incoming", "uploads", "bundled");
  await fs.mkdir(uploadsRoot, { recursive: true });

  const workDir = path.join(uploadsRoot, `${cityCode}_bootstrap`);
  const extractedDir = path.join(workDir, "extracted");
  const normalizedDir = path.join(workDir, "normalized");

  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(extractedDir, { recursive: true });
  await fs.mkdir(normalizedDir, { recursive: true });

  const zip = new AdmZip(zipPath);
  zip.extractAllTo(extractedDir, true);

  const resolved = {};

  for (const fileName of REQUIRED_FILES) {
    const found = await findFeedFile(extractedDir, fileName);
    if (!found) {
      throw new Error(`File GTFS mancante: ${fileName}`);
    }
    resolved[fileName] = found;
  }

  for (const [fileName, columns] of Object.entries(OPTIONAL_FILES)) {
    const found = await findFeedFile(extractedDir, fileName);
    if (found) {
      resolved[fileName] = found;
    } else {
      const fallbackPath = path.join(extractedDir, fileName);
      await ensureOptionalFile(fallbackPath, columns);
      resolved[fileName] = fallbackPath;
    }
  }

  for (const [fileName, columns] of Object.entries(NORMALIZED_COLUMNS)) {
    const outputPath = path.join(normalizedDir, fileName);
    await normalizeCsv(resolved[fileName], outputPath, columns);
    resolved[fileName] = outputPath;
  }

  const template = await fs.readFile(path.join(repoRoot, "db", "import_gtfs.sql"), "utf8");
  const sql = template
    .replaceAll(":'agency_file'", `'${toUnixPath(path.join("/work", path.relative(repoRoot, resolved["agency.txt"])))}'`)
    .replaceAll(":'routes_file'", `'${toUnixPath(path.join("/work", path.relative(repoRoot, resolved["routes.txt"])))}'`)
    .replaceAll(":'stops_file'", `'${toUnixPath(path.join("/work", path.relative(repoRoot, resolved["stops.txt"])))}'`)
    .replaceAll(
      ":'calendar_file'",
      `'${toUnixPath(path.join("/work", path.relative(repoRoot, resolved["calendar.txt"])))}'`
    )
    .replaceAll(":'trips_file'", `'${toUnixPath(path.join("/work", path.relative(repoRoot, resolved["trips.txt"])))}'`)
    .replaceAll(
      ":'stop_times_file'",
      `'${toUnixPath(path.join("/work", path.relative(repoRoot, resolved["stop_times.txt"])))}'`
    )
    .replaceAll(
      ":'fare_attributes_file'",
      `'${toUnixPath(path.join("/work", path.relative(repoRoot, resolved["fare_attributes.txt"])))}'`
    )
    .replaceAll(":'city_code'", `'${cityCode}'`)
    .replaceAll(":'city_name'", `'${cityName.replaceAll("'", "''")}'`)
    .replaceAll(":'service_date'", `'${serviceDate}'`);

  const sqlFile = path.join(workDir, "import.sql");
  await fs.writeFile(sqlFile, sql, "utf8");

  const sqlInWorkdir = toUnixPath(path.join("/work", path.relative(repoRoot, sqlFile)));
  await spawnPromise("docker", [
    "run",
    "--rm",
    "--network",
    "container:gtfs-postgres",
    "-e",
    "PGPASSWORD=postgres",
    "-v",
    `${repoRoot}:/work`,
    "-w",
    "/work",
    "postgres:16",
    "psql",
    "-h",
    "localhost",
    "-U",
    "postgres",
    "-d",
    "gtfs_ticketing",
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    sqlInWorkdir
  ]);
}

async function main() {
  const cityCode = "CAG";
  const cityName = "Cagliari";
  const zipPath = path.join(repoRoot, "data", "gtfs", "incoming", "CAG_sample.zip");

  try {
    await fs.access(zipPath);
  } catch {
    console.log("Feed Cagliari non presente nel repository, salto import automatico.");
    return;
  }

  if (await cityExists(cityCode)) {
    console.log("Cagliari gia` presente nel database, salto import automatico.");
    return;
  }

  const serviceDate = new Date().toISOString().slice(0, 10);
  console.log("Import automatico del feed bundled di Cagliari...");
  await importZip({ zipPath, cityCode, cityName, serviceDate });
  console.log("Import Cagliari completato.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
