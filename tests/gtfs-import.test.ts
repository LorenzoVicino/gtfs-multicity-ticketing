import assert from "node:assert/strict";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import AdmZip from "adm-zip";
import {
  assertArchiveFitsOnDisk,
  cleanupStaleWorkDirs,
  ensureOptionalFile,
  normalizeCsv,
  uncompressedSize
} from "@/lib/gtfs-import";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "gtfs-import-test-"));
}

const TRIP_COLUMNS = ["route_id", "service_id", "trip_id", "shape_id"];

test("normalizeCsv reorders columns, fills the missing ones and drops the extras", async () => {
  const dir = await tempDir();
  const input = path.join(dir, "trips.txt");
  const output = path.join(dir, "trips.normalized.txt");

  // Deliberately hostile: columns out of order, one absent, one the schema ignores.
  await fs.writeFile(input, ["trip_id,unknown_extra,route_id", "T1,ignored,R1", "T2,ignored,R2"].join("\n"), "utf8");

  await normalizeCsv(input, output, TRIP_COLUMNS);

  assert.equal(
    await fs.readFile(output, "utf8"),
    ["route_id,service_id,trip_id,shape_id", "R1,,T1,", "R2,,T2,", ""].join("\n")
  );
});

test("normalizeCsv strips a byte order mark from the header", async () => {
  const dir = await tempDir();
  const input = path.join(dir, "trips.txt");
  const output = path.join(dir, "out.txt");

  await fs.writeFile(input, "﻿trip_id,route_id\nT1,R1\n", "utf8");
  await normalizeCsv(input, output, ["route_id", "trip_id"]);

  const text = await fs.readFile(output, "utf8");
  assert.equal(text, "route_id,trip_id\nR1,T1\n");
  assert.ok(!text.includes("﻿"));
});

test("normalizeCsv streams a file larger than a comfortable buffer", async () => {
  const dir = await tempDir();
  const input = path.join(dir, "stop_times.txt");
  const output = path.join(dir, "out.txt");

  const rows = 60_000;
  const lines = ["trip_id,stop_sequence,stop_id"];
  for (let index = 0; index < rows; index += 1) {
    lines.push(`T${index},${index},S${index}`);
  }
  await fs.writeFile(input, `${lines.join("\n")}\n`, "utf8");

  await normalizeCsv(input, output, ["trip_id", "stop_id", "stop_sequence"]);

  const written = (await fs.readFile(output, "utf8")).trimEnd().split("\n");
  assert.equal(written.length, rows + 1);
  assert.equal(written[0], "trip_id,stop_id,stop_sequence");
  assert.equal(written[1], "T0,S0,0");
  assert.equal(written[rows], `T${rows - 1},S${rows - 1},${rows - 1}`);
});

test("ensureOptionalFile writes a header the importer can copy from", async () => {
  const dir = await tempDir();
  const filePath = path.join(dir, "calendar_dates.txt");

  await ensureOptionalFile(filePath, ["service_id", "date", "exception_type"]);

  assert.equal(await fs.readFile(filePath, "utf8"), "service_id,date,exception_type\n");
});

test("the archive guardrail measures the extracted size, not the compressed one", async () => {
  const zip = new AdmZip();
  // Highly compressible, so the entry is tiny on disk and large once extracted.
  zip.addFile("stop_times.txt", Buffer.alloc(4 * 1024 * 1024, "a"));

  assert.equal(uncompressedSize(zip), 4 * 1024 * 1024);
  assert.ok(zip.toBuffer().length < uncompressedSize(zip));

  const previous = process.env.GTFS_MAX_UNCOMPRESSED_MB;
  try {
    process.env.GTFS_MAX_UNCOMPRESSED_MB = "1";
    assert.throws(() => assertArchiveFitsOnDisk(zip), /decompresso/);

    process.env.GTFS_MAX_UNCOMPRESSED_MB = "64";
    assert.doesNotThrow(() => assertArchiveFitsOnDisk(zip));
  } finally {
    if (previous === undefined) {
      delete process.env.GTFS_MAX_UNCOMPRESSED_MB;
    } else {
      process.env.GTFS_MAX_UNCOMPRESSED_MB = previous;
    }
  }
});

test("the sweep removes stale working copies and nothing else", async () => {
  const root = await tempDir();
  const now = Date.UTC(2026, 7, 26, 12, 0, 0);
  const stale = new Date(now - 12 * 60 * 60 * 1000);

  const staleWorkDir = path.join(root, "BA_1787643335502");
  const freshWorkDir = path.join(root, "BRI_1787999999999");
  const workspaces = path.join(root, "workspaces");
  const sources = path.join(root, "sources");
  const namedDir = path.join(root, "CAG_bootstrap");
  const archive = path.join(root, "BA_1787643335494.zip");

  for (const dir of [staleWorkDir, freshWorkDir, workspaces, sources, namedDir]) {
    await fs.mkdir(path.join(dir, "extracted"), { recursive: true });
  }
  await fs.writeFile(archive, "not really a zip", "utf8");

  // Only the work directory is aged; everything else keeps its current mtime.
  for (const dir of [staleWorkDir, workspaces, sources, namedDir]) {
    await fs.utimes(dir, stale, stale);
  }

  const removed = await cleanupStaleWorkDirs(root, now);

  assert.deepEqual(removed, ["BA_1787643335502"]);
  assert.ok(!existsSync(staleWorkDir), "the stale working copy should be gone");
  assert.ok(existsSync(freshWorkDir), "a recent working copy may still be in use");
  assert.ok(existsSync(workspaces), "workspaces are not working copies");
  assert.ok(existsSync(sources), "published sources are not working copies");
  assert.ok(existsSync(namedDir), "a directory that is not <code>_<stamp> is not ours to delete");
  assert.ok(existsSync(archive), "an uploaded archive can be the only copy of a feed");
});
