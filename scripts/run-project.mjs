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

function resolveCommand(command) {
  if (process.platform === "win32" && command === "npm") {
    return "npm.cmd";
  }

  return command;
}

function resolveSpawnOptions(command, baseOptions = {}) {
  if (process.platform === "win32" && command === "npm") {
    return {
      ...baseOptions,
      shell: true
    };
  }

  return baseOptions;
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveCommand(command), commandArgs, {
      cwd: repoRoot,
      stdio: "inherit",
      ...resolveSpawnOptions(command, options)
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
    const child = spawn(resolveCommand(command), commandArgs, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      ...resolveSpawnOptions(command),
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

function withNodeHeapSize(env, heapSizeMb) {
  const current = env.NODE_OPTIONS?.trim() ?? "";
  const heapFlag = `--max-old-space-size=${heapSizeMb}`;

  if (current.includes("--max-old-space-size=")) {
    return env;
  }

  return {
    ...env,
    NODE_OPTIONS: current ? `${current} ${heapFlag}` : heapFlag
  };
}

function describeContainerStatus(status) {
  switch (status) {
    case "created":
      return "container creato, avvio in corso";
    case "restarting":
      return "container in riavvio";
    case "starting":
      return "database in inizializzazione";
    case "running":
      return "container avviato, attendo healthcheck";
    case "healthy":
      return "database pronto";
    case "unhealthy":
      return "container avviato ma healthcheck fallito";
    case "exited":
      return "container terminato";
    default:
      return `stato rilevato: ${status || "sconosciuto"}`;
  }
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

  const maxAttempts = 45;
  const waitMs = 2000;
  console.log(
    `Attendo che il database sia pronto... (max ${Math.round((maxAttempts * waitMs) / 1000)}s)`
  );
  let dbReady = false;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const status = await runCapture("docker", [
        "inspect",
        "--format",
        "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
        "gtfs-postgres"
      ]);

      const normalizedStatus = status || "unknown";
      console.log(
        `  [${attempt + 1}/${maxAttempts}] ${describeContainerStatus(normalizedStatus)} (${normalizedStatus})`
      );

      if (normalizedStatus === "healthy" || normalizedStatus === "running") {
        dbReady = true;
        console.log("Database pronto.");
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  [${attempt + 1}/${maxAttempts}] container non ancora interrogabile: ${message}`);
    }

    await sleep(waitMs);
  }

  if (!dbReady) {
    throw new Error("Il container PostgreSQL non e` diventato pronto in tempo utile.");
  }

  const shouldInstall = !skipInstall || !existsSync(path.join(repoRoot, "node_modules"));
  if (shouldInstall) {
    console.log("Installazione dipendenze npm...");
    await run("npm", ["install"]);
  } else {
    console.log("Dipendenze gia` presenti, salto npm install.");
  }

  console.log("Verifica dataset bundled aggiuntivi...");
  await run("node", ["scripts/import-bundled-gtfs.mjs"], {
    env: withNodeHeapSize(process.env, 4096)
  });

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
