import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { importGtfsZip } from "@/lib/gtfs-import";

// This used to carry its own copy of the whole import pipeline: file discovery,
// CSV normalization, SQL rendering and the psql invocation. The copies drifted --
// calendar_dates.txt reached one and not the other -- so the pipeline now lives in
// lib/gtfs-import.ts and this script only decides whether to run it.

const repoRoot = path.resolve(import.meta.dirname, "..");

function spawnPromise(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
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

async function cityExists(cityCode: string): Promise<boolean> {
  try {
    const { stdout } = await spawnPromise("docker", [
      "exec", "gtfs-postgres",
      "psql", "-U", "postgres", "-d", "gtfs_hub", "-tAc",
      `SELECT 1 FROM transport.city WHERE city_code = '${cityCode}' LIMIT 1;`
    ]);
    return stdout.trim() === "1";
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const cityCode = "CAG";
  const cityName = "Cagliari";
  const zipPath = path.join(repoRoot, "data", "gtfs", "incoming", "CAG_sample.zip");

  try {
    await fs.access(zipPath);
  } catch {
    console.log("The Cagliari feed is not present in the repository; skipping automatic import.");
    return;
  }

  if (await cityExists(cityCode)) {
    console.log("Cagliari is already present in the database; skipping feed reimport.");
    return;
  }

  console.log("Automatically importing the bundled Cagliari feed...");
  await importGtfsZip({
    zipPath,
    cityCode,
    cityName,
    uploadsRoot: path.join(repoRoot, "data", "gtfs", "incoming", "uploads", "bundled")
  });
  console.log("Cagliari import complete.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
