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
      return "container created, starting";
    case "restarting":
      return "container restarting";
    case "starting":
      return "database initializing";
    case "running":
      return "container running, waiting for health check";
    case "healthy":
      return "database ready";
    case "unhealthy":
      return "container running but health check failed";
    case "exited":
      return "container exited";
    default:
      return `detected status: ${status || "unknown"}`;
  }
}

async function main() {
  const envExample = path.join(repoRoot, ".env.example");
  const envLocal = path.join(repoRoot, ".env.local");

  if (!existsSync(envLocal) && existsSync(envExample)) {
    copyFileSync(envExample, envLocal);
    console.log("Created .env.local from .env.example");
  }

  console.log("Starting PostgreSQL and MobilityData Validator with Docker Compose...");
  await run("docker", ["compose", "up", "-d", "postgres", "gtfs-validator"]);

  const maxAttempts = 45;
  const waitMs = 2000;
  console.log(
    `Waiting for the database to become ready... (up to ${Math.round((maxAttempts * waitMs) / 1000)}s)`
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
        console.log("Database ready.");
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  [${attempt + 1}/${maxAttempts}] container is not available yet: ${message}`);
    }

    await sleep(waitMs);
  }

  if (!dbReady) {
    throw new Error("The PostgreSQL container did not become ready in time.");
  }

  const shouldInstall = !skipInstall || !existsSync(path.join(repoRoot, "node_modules"));
  if (shouldInstall) {
    console.log("Installing npm dependencies...");
    await run("npm", ["install"]);
  } else {
    console.log("Dependencies are already installed; skipping npm install.");
  }

  console.log("Checking additional bundled datasets...");
  await run("node", ["scripts/import-bundled-gtfs.mjs"], {
    env: withNodeHeapSize(process.env, 4096)
  });

  if (setupOnly) {
    console.log("Setup complete. The database, validator, and dependencies are ready.");
    return;
  }

  console.log("Starting the application at http://localhost:3000 ...");
  await run("npm", ["run", "dev"]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
