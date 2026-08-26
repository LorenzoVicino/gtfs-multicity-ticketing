import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
import { parse } from "csv-parse";
import { stringify } from "csv-stringify";

export type ImportParams = {
  zipPath: string;
  cityCode: string;
  cityName: string;
  /** Where the working copies live. Defaults to data/gtfs/incoming/uploads. */
  uploadsRoot?: string;
  /** Keep the working directory instead of removing it, to inspect a failed import. */
  keepWorkDir?: boolean;
};

// The bundled Cagliari sample alone is 128 MB uncompressed, so this cannot be
// tight. It is a guardrail against a malformed archive quietly filling the disk,
// not a security boundary: this runs locally, on feeds the operator chose.
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 400 * 1024 * 1024;

function maxUncompressedBytes(): number {
  const raw = process.env.GTFS_MAX_UNCOMPRESSED_MB?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed * 1024 * 1024 : DEFAULT_MAX_UNCOMPRESSED_BYTES;
}

/** Total size the archive would occupy once extracted, without extracting it. */
export function uncompressedSize(zip: AdmZip): number {
  return zip.getEntries().reduce((total, entry) => entry.isDirectory ? total : total + entry.header.size, 0);
}

export function assertArchiveFitsOnDisk(zip: AdmZip): void {
  const limit = maxUncompressedBytes();
  const size = uncompressedSize(zip);
  if (size > limit) {
    throw new Error(
      `L'archivio occupa ${Math.round(size / 1024 / 1024)} MB decompresso, oltre il limite di ${Math.round(limit / 1024 / 1024)} MB. Se il feed è legittimo, alza GTFS_MAX_UNCOMPRESSED_MB.`
    );
  }
}

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
  "calendar_dates.txt": ["service_id", "date", "exception_type"],
  "shapes.txt": ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence", "shape_dist_traveled"],
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
  "calendar_dates.txt": OPTIONAL_FILES["calendar_dates.txt"],
  "shapes.txt": OPTIONAL_FILES["shapes.txt"],
  "trips.txt": [
    "route_id",
    "service_id",
    "trip_id",
    "trip_headsign",
    "trip_short_name",
    "direction_id",
    "block_id",
    "wheelchair_accessible",
    "bikes_allowed",
    "shape_id"
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

export async function ensureOptionalFile(filePath: string, columns: string[]): Promise<void> {
  await fs.writeFile(filePath, stringify([], { header: true, columns }), "utf8");
}

/**
 * Rewrite a GTFS file with exactly `columns`, in that order, so \copy can trust
 * the layout. Streamed rather than read whole: a real stop_times.txt runs to tens
 * of megabytes, and parsing that synchronously held the entire feed, plus a record
 * object per row, in memory.
 */
export async function normalizeCsv(inputPath: string, outputPath: string, columns: string[]): Promise<void> {
  await pipeline(
    createReadStream(inputPath, { encoding: "utf8" }),
    parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }),
    new Transform({
      objectMode: true,
      transform(row: Record<string, string>, _encoding, callback) {
        const next: Record<string, string> = {};
        for (const column of columns) {
          const value = row[column];
          next[column] = value == null ? "" : String(value);
        }
        callback(null, next);
      }
    }),
    stringify({ header: true, columns }),
    createWriteStream(outputPath, { encoding: "utf8" })
  );
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
    "postgres:16", "psql", "-h", "localhost", "-U", "postgres", "-d", "gtfs_hub",
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

/**
 * One import per city at a time. Two concurrent imports of the same city would
 * interleave their psql transactions over the same rows; a double-clicked button
 * is enough to trigger it. In-process only, which is all a single local server
 * needs -- it does not coordinate with a separate CLI run.
 */
const importsInFlight = new Map<string, Promise<void>>();

export async function importGtfsZip(params: ImportParams): Promise<void> {
  const cityCode = safeCode(params.cityCode);
  if (!cityCode) {
    throw new Error("City code non valido");
  }

  const previous = importsInFlight.get(cityCode) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => runImport({ ...params, cityCode }));

  importsInFlight.set(cityCode, current);
  try {
    await current;
  } finally {
    if (importsInFlight.get(cityCode) === current) {
      importsInFlight.delete(cityCode);
    }
  }
}

const WORK_DIR_TTL_MS = 6 * 60 * 60 * 1000;
const WORK_DIR_PATTERN = /^[A-Z0-9_-]+_\d{10,}$/;

/**
 * Remove working copies a previous import left behind. The finally block below
 * covers the normal path, including failures, but not a killed process -- and the
 * leftovers are large: an extracted feed plus its normalized copy.
 *
 * Only derived directories are swept. Uploaded archives are never touched: they can
 * be the sole copy of a feed, while an extracted copy is always reproducible.
 */
export async function cleanupStaleWorkDirs(uploadsRoot: string, now = Date.now()): Promise<string[]> {
  const entries = await fs.readdir(uploadsRoot, { withFileTypes: true }).catch(() => []);
  const removed: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !WORK_DIR_PATTERN.test(entry.name)) {
      continue;
    }

    const dirPath = path.join(uploadsRoot, entry.name);
    const stat = await fs.stat(dirPath).catch(() => null);
    if (!stat || now - stat.mtimeMs < WORK_DIR_TTL_MS) {
      continue;
    }

    await fs.rm(dirPath, { recursive: true, force: true }).catch(() => undefined);
    removed.push(entry.name);
  }

  return removed;
}

async function runImport(params: ImportParams & { cityCode: string }): Promise<void> {
  const cityCode = params.cityCode;
  const uploadsRoot = params.uploadsRoot ?? path.join(process.cwd(), "data", "gtfs", "incoming", "uploads");
  await fs.mkdir(uploadsRoot, { recursive: true });
  await cleanupStaleWorkDirs(uploadsRoot);

  const stamp = Date.now();
  const workDir = path.join(uploadsRoot, `${cityCode}_${stamp}`);
  const extractedDir = path.join(workDir, "extracted");
  const normalizedDir = path.join(workDir, "normalized");

  try {
    await importIntoWorkDir(params, cityCode, workDir, extractedDir, normalizedDir);
  } finally {
    // The extracted copy plus the normalized copy of a city feed is easily a few
    // hundred megabytes. Leaving them behind filled the disk one import at a time.
    if (!params.keepWorkDir) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function importIntoWorkDir(
  params: ImportParams,
  cityCode: string,
  workDir: string,
  extractedDir: string,
  normalizedDir: string
): Promise<void> {
  await fs.mkdir(extractedDir, { recursive: true });
  await fs.mkdir(normalizedDir, { recursive: true });

  const zip = new AdmZip(params.zipPath);
  assertArchiveFitsOnDisk(zip);
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
    .replaceAll(":'calendar_dates_file'", `'${importPath(resolved["calendar_dates.txt"])}'`)
    .replaceAll(":'trips_file'", `'${importPath(resolved["trips.txt"])}'`)
    .replaceAll(":'shapes_file'", `'${importPath(resolved["shapes.txt"])}'`)
    .replaceAll(
      ":'stop_times_file'",
      `'${importPath(resolved["stop_times.txt"])}'`
    )
    .replaceAll(
      ":'fare_attributes_file'",
      `'${importPath(resolved["fare_attributes.txt"])}'`
    )
    .replaceAll(":'city_code'", `'${cityCode}'`)
    .replaceAll(":'city_name'", `'${params.cityName.replaceAll("'", "''")}'`);

  const sqlFile = path.join(workDir, "import.sql");
  await fs.writeFile(sqlFile, sql, "utf8");

  if (directImport) {
    await runDirectImport(sqlFile);
  } else {
    const sqlInWorkdir = toUnixPath(path.join("/work", path.relative(process.cwd(), sqlFile)));
    await runDockerImport(sqlInWorkdir);
  }
}
