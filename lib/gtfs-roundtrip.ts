import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { createGtfsArchive } from "@/lib/gtfs-builder-archive";
import { parseGtfsArchive } from "@/lib/gtfs-builder-parser";
import type { GtfsBuilderDraft, GtfsSourceFile } from "@/types/gtfs-builder";

type CsvRecord = Record<string, string>;
type CsvTable = { columns: string[]; rows: CsvRecord[] };

export const MANAGED_GTFS_FILES = new Set([
  "agency.txt",
  "stops.txt",
  "routes.txt",
  "calendar.txt",
  "calendar_dates.txt",
  "trips.txt",
  "stop_times.txt",
  "shapes.txt",
  "feed_info.txt"
]);

const CSV_KEYS: Record<string, string[]> = {
  "agency.txt": ["agency_id"],
  "stops.txt": ["stop_id"],
  "routes.txt": ["route_id"],
  "calendar.txt": ["service_id"],
  "calendar_dates.txt": ["service_id", "date"],
  "trips.txt": ["trip_id"],
  "stop_times.txt": ["trip_id", "stop_sequence"],
  "feed_info.txt": []
};

function archiveName(entryName: string): string {
  return entryName.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
}

function normalizeDraftForFingerprint(draft: GtfsBuilderDraft) {
  return {
    agencies: draft.agencies,
    services: draft.services.map((service) => ({ ...service, exceptions: service.exceptions ?? [] })),
    stops: draft.stops,
    routes: draft.routes,
    trips: draft.trips,
    feedInfo: draft.feedInfo ?? null
  };
}

export function fingerprintGtfsDraft(draft: GtfsBuilderDraft): string {
  return createHash("sha256").update(JSON.stringify(normalizeDraftForFingerprint(draft))).digest("hex");
}

export function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function inspectGtfsArchive(buffer: Buffer): GtfsSourceFile[] {
  const zip = new AdmZip(buffer);
  const seen = new Set<string>();
  const files: GtfsSourceFile[] = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = archiveName(entry.entryName);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    files.push({ name, size: entry.header.size, managed: MANAGED_GTFS_FILES.has(name) });
  }
  return files;
}

function readCsv(buffer: Buffer): CsvTable {
  const matrix = parse(buffer.toString("utf8"), {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true
  }) as string[][];
  const columns = (matrix[0] ?? []).map((column) => String(column));
  const rows = matrix.slice(1).map((values) => Object.fromEntries(columns.map((column, index) => [column, values[index] == null ? "" : String(values[index])])));
  return { columns, rows };
}

function writeCsv(table: CsvTable): Buffer {
  return Buffer.from(stringify(table.rows, {
    header: true,
    columns: table.columns,
    record_delimiter: "windows"
  }), "utf8");
}

function rowKey(row: CsvRecord, keyColumns: string[], index: number): string {
  return keyColumns.length === 0 ? String(index) : keyColumns.map((column) => row[column] ?? "").join("\u0000");
}

function mergeCsv(original: Buffer | undefined, generated: Buffer, keyColumns: string[], modeledSourceKeys: Set<string>): Buffer {
  if (!original) return generated;
  const source = readCsv(original);
  const next = readCsv(generated);
  const columns = [...source.columns, ...next.columns.filter((column) => !source.columns.includes(column))];
  const sourceByKey = new Map(source.rows.map((row, index) => [rowKey(row, keyColumns, index), row]));
  const nextKeys = new Set(next.rows.map((row, index) => rowKey(row, keyColumns, index)));
  const rows = next.rows.map((row, index) => ({
    ...(sourceByKey.get(rowKey(row, keyColumns, index)) ?? {}),
    ...row
  }));
  source.rows.forEach((row, index) => {
    const key = rowKey(row, keyColumns, index);
    if (!nextKeys.has(key) && !modeledSourceKeys.has(key)) rows.push(row);
  });
  return writeCsv({ columns, rows });
}

function mergeShapes(original: Buffer | undefined, generated: Buffer, generatedTrips: Buffer, originalDraft: GtfsBuilderDraft): Buffer {
  if (!original) return generated;
  const source = readCsv(original);
  const next = readCsv(generated);
  const trips = readCsv(generatedTrips);
  const referencedShapeIds = new Set(trips.rows.map((row) => row.shape_id).filter(Boolean));
  const originallyReferencedShapeIds = new Set(originalDraft.trips.map((trip) => trip.shapeId).filter((shapeId): shapeId is string => Boolean(shapeId)));
  const sourceShapeIds = new Set(source.rows.map((row) => row.shape_id).filter(Boolean));
  const columns = [...source.columns, ...next.columns.filter((column) => !source.columns.includes(column))];
  const sourceRows = source.rows.filter((row) => referencedShapeIds.has(row.shape_id) || !originallyReferencedShapeIds.has(row.shape_id));
  const generatedRows = next.rows.filter((row) => !sourceShapeIds.has(row.shape_id));
  return writeCsv({ columns, rows: [...sourceRows, ...generatedRows] });
}

function modeledKeysByFile(draft: GtfsBuilderDraft): Record<string, Set<string>> {
  const keys = (values: string[][]) => new Set(values.map((value) => value.join("\u0000")));
  return {
    "agency.txt": keys(draft.agencies.map((agency) => [agency.id])),
    "stops.txt": keys(draft.stops.map((stop) => [stop.id])),
    "routes.txt": keys(draft.routes.map((route) => [route.id])),
    "calendar.txt": keys(draft.services.map((service) => [service.id])),
    "calendar_dates.txt": keys(draft.services.flatMap((service) => (service.exceptions ?? []).map((exception) => [service.id, exception.date.replaceAll("-", "")]))),
    "trips.txt": keys(draft.trips.map((trip) => [trip.id])),
    "stop_times.txt": keys(draft.trips.flatMap((trip) => trip.stopTimes.map((stopTime, index) => [trip.id, String(stopTime.stopSequence ?? index + 1)]))),
    "feed_info.txt": draft.feedInfo ? new Set(["0"]) : new Set()
  };
}

function zipFiles(buffer: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const zip = new AdmZip(buffer);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = archiveName(entry.entryName);
    if (name && !files.has(name)) files.set(name, entry.getData());
  }
  return files;
}

export type RoundTripMode = "original" | "merged" | "generated";

export type RoundTripArchive = {
  buffer: Buffer;
  mode: RoundTripMode;
  originalSha256?: string;
  outputSha256: string;
};

export function buildRoundTripArchive(draft: GtfsBuilderDraft, sourceArchive?: Buffer): RoundTripArchive {
  if (!sourceArchive) {
    const buffer = createGtfsArchive(draft);
    return { buffer, mode: "generated", outputSha256: sha256Buffer(buffer) };
  }

  const originalSha256 = sha256Buffer(sourceArchive);
  const originalDraft = parseGtfsArchive(sourceArchive, draft.project);
  if (fingerprintGtfsDraft(originalDraft) === fingerprintGtfsDraft(draft)) {
    return {
      buffer: sourceArchive,
      mode: "original",
      originalSha256,
      outputSha256: originalSha256
    };
  }

  const generatedArchive = createGtfsArchive(draft);
  const originalFiles = zipFiles(sourceArchive);
  const generatedFiles = zipFiles(generatedArchive);
  const originalModeledKeys = modeledKeysByFile(originalDraft);
  const merged = new AdmZip();
  const written = new Set<string>();

  for (const [name, original] of originalFiles) {
    const generated = generatedFiles.get(name);
    if (!generated || !MANAGED_GTFS_FILES.has(name)) {
      merged.addFile(name, original);
      written.add(name);
      continue;
    }

    if (name === "shapes.txt") {
      const trips = generatedFiles.get("trips.txt");
      merged.addFile(name, trips ? mergeShapes(original, generated, trips, originalDraft) : original);
    } else {
      merged.addFile(name, mergeCsv(original, generated, CSV_KEYS[name] ?? [], originalModeledKeys[name] ?? new Set()));
    }
    written.add(name);
  }

  for (const [name, generated] of generatedFiles) {
    if (!written.has(name)) {
      merged.addFile(name, generated);
      written.add(name);
    }
  }

  const buffer = merged.toBuffer();
  return {
    buffer,
    mode: "merged",
    originalSha256,
    outputSha256: sha256Buffer(buffer)
  };
}
