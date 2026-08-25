import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

type ImportParams = {
  zipPath: string;
  cityCode: string;
  cityName: string;
  serviceDate: string;
};

const REQUIRED_FILES = ["agency.txt", "routes.txt", "stops.txt", "trips.txt", "stop_times.txt"];

const OPTIONAL_FILES: Record<string, string[]> = {
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

const NORMALIZED_COLUMNS: Record<string, string[]> = {
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

function toUnixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

function safeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 16);
}

async function findFeedFile(dir: string, targetLower: string): Promise<string | null> {
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

async function writeCsvFile(filePath: string, columns: string[], rows: Record<string, string>[]): Promise<void> {
  const csv = stringify(rows, { header: true, columns });
  await fs.writeFile(filePath, csv, "utf8");
}

async function ensureOptionalFile(filePath: string, columns: string[]): Promise<void> {
  const csv = stringify([], { header: true, columns });
  await fs.writeFile(filePath, csv, "utf8");
}

async function normalizeCsv(inputPath: string, outputPath: string, columns: string[]): Promise<void> {
  const text = await fs.readFile(inputPath, "utf8");
  const records = parse(text, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true
  }) as Record<string, string>[];

  const normalized = records.map((row) => {
    const next: Record<string, string> = {};
    for (const column of columns) {
      const value = row[column];
      next[column] = value == null ? "" : String(value);
    }
    return next;
  });

  await writeCsvFile(outputPath, columns, normalized);
}

function runImportProcess(command: string, args: string[], label: string, env = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(new Error(`Errore avvio ${label}: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `Import fallito con exit code ${code}`));
    });
  });
}

function runDockerImport(sqlPathInWorkdir: string): Promise<void> {
  return runImportProcess("docker", [
    "run", "--rm", "--network", "container:gtfs-postgres",
    "-e", "PGPASSWORD=postgres",
    "-v", `${process.cwd()}:/work`, "-w", "/work",
    "postgres:16", "psql", "-h", "localhost", "-U", "postgres", "-d", "gtfs_ticketing",
    "-v", "ON_ERROR_STOP=1", "-f", sqlPathInWorkdir
  ], "docker");
}

function runDirectImport(sqlPath: string): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return runImportProcess(process.env.PSQL_BIN || "psql", [connectionString, "-v", "ON_ERROR_STOP=1", "-f", sqlPath], "psql");
  }
  if (!process.env.PGHOST || !process.env.PGUSER || !process.env.PGDATABASE) {
    throw new Error("DATABASE_URL o variabili PostgreSQL PG* non configurate");
  }
  return runImportProcess(process.env.PSQL_BIN || "psql", [
    "-h", process.env.PGHOST,
    "-p", process.env.PGPORT || "5432",
    "-U", process.env.PGUSER,
    "-d", process.env.PGDATABASE,
    "-v", "ON_ERROR_STOP=1",
    "-f", sqlPath
  ], "psql", { ...process.env, PGPASSWORD: process.env.PGPASSWORD || "" });
}

export async function importGtfsZip(params: ImportParams): Promise<void> {
  const cityCode = safeCode(params.cityCode);
  if (!cityCode) {
    throw new Error("City code non valido");
  }

  const uploadsRoot = path.join(process.cwd(), "data", "gtfs", "incoming", "uploads");
  await fs.mkdir(uploadsRoot, { recursive: true });

  const stamp = Date.now();
  const workDir = path.join(uploadsRoot, `${cityCode}_${stamp}`);
  const extractedDir = path.join(workDir, "extracted");
  const normalizedDir = path.join(workDir, "normalized");

  await fs.mkdir(extractedDir, { recursive: true });
  await fs.mkdir(normalizedDir, { recursive: true });

  const zip = new AdmZip(params.zipPath);
  zip.extractAllTo(extractedDir, true);

  const resolved: Record<string, string> = {};

  for (const fileName of REQUIRED_FILES) {
    const found = await findFeedFile(extractedDir, fileName);
    if (!found) {
      throw new Error(`File GTFS mancante: ${fileName}`);
    }
    resolved[fileName] = found;
  }

  for (const [fileName, cols] of Object.entries(OPTIONAL_FILES)) {
    const found = await findFeedFile(extractedDir, fileName);
    if (found) {
      resolved[fileName] = found;
    } else {
      const fallbackPath = path.join(extractedDir, fileName);
      await ensureOptionalFile(fallbackPath, cols);
      resolved[fileName] = fallbackPath;
    }
  }

  for (const [fileName, cols] of Object.entries(NORMALIZED_COLUMNS)) {
    const inputPath = resolved[fileName];
    const outputPath = path.join(normalizedDir, fileName);
    await normalizeCsv(inputPath, outputPath, cols);
    resolved[fileName] = outputPath;
  }

  const template = await fs.readFile(path.join(process.cwd(), "db", "import_gtfs.sql"), "utf8");
  const directImport = process.env.GTFS_IMPORT_MODE === "psql";
  const importPath = (filePath: string) => directImport
    ? toUnixPath(filePath)
    : toUnixPath(path.join("/work", path.relative(process.cwd(), filePath)));
  const sql = template
    .replaceAll(":'agency_file'", `'${importPath(resolved["agency.txt"])}'`)
    .replaceAll(":'routes_file'", `'${importPath(resolved["routes.txt"])}'`)
    .replaceAll(":'stops_file'", `'${importPath(resolved["stops.txt"])}'`)
    .replaceAll(":'calendar_file'", `'${importPath(resolved["calendar.txt"])}'`)
    .replaceAll(":'trips_file'", `'${importPath(resolved["trips.txt"])}'`)
    .replaceAll(
      ":'stop_times_file'",
      `'${importPath(resolved["stop_times.txt"])}'`
    )
    .replaceAll(
      ":'fare_attributes_file'",
      `'${importPath(resolved["fare_attributes.txt"])}'`
    )
    .replaceAll(":'city_code'", `'${cityCode}'`)
    .replaceAll(":'city_name'", `'${params.cityName.replaceAll("'", "''")}'`)
    .replaceAll(":'service_date'", `'${params.serviceDate}'`);

  const sqlFile = path.join(workDir, "import.sql");
  await fs.writeFile(sqlFile, sql, "utf8");

  if (directImport) {
    await runDirectImport(sqlFile);
  } else {
    const sqlInWorkdir = toUnixPath(path.join("/work", path.relative(process.cwd(), sqlFile)));
    await runDockerImport(sqlInWorkdir);
  }
}
