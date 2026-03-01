import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));
const skipInstall = args.has("--skip-install");
const setupOnly = args.has("--setup-only");

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${code}`));
    });
  });
}

function runCapture(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32"
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `${command} failed with exit code ${code}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const envExample = path.join(repoRoot, ".env.example");
  const envLocal = path.join(repoRoot, ".env.local");

  if (!existsSync(envLocal) && existsSync(envExample)) {
    copyFileSync(envExample, envLocal);
    console.log("Creato .env.local a partire da .env.example");
  }

  console.log("Avvio PostgreSQL con Docker Compose...");
  await run("docker", ["compose", "up", "-d", "postgres"]);

  console.log("Attendo che il database sia pronto...");
  let dbReady = false;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    try {
      const status = await runCapture("docker", [
        "inspect",
        "--format",
        "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
        "gtfs-postgres"
      ]);

      if (status === "healthy" || status === "running") {
        dbReady = true;
        break;
      }
    } catch {
      // Keep polling until the container becomes available.
    }

    await sleep(2000);
  }

  if (!dbReady) {
    throw new Error("Il container PostgreSQL non e` diventato pronto in tempo utile.");
  }

  const shouldInstall = !skipInstall || !existsSync(path.join(repoRoot, "node_modules"));
  if (shouldInstall) {
    console.log("Installazione dipendenze npm...");
    await run("npm", ["install"]);
  }

  if (setupOnly) {
    console.log("Setup completato. Database attivo e dipendenze pronte.");
    return;
  }

  console.log("Avvio applicazione su http://localhost:3000 ...");
  await run("npm", ["run", "dev"]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
