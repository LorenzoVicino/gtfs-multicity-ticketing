import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

function normalizeConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);

    if (url.searchParams.get("sslmode") === "require" && !url.searchParams.has("uselibpqcompat")) {
      url.searchParams.set("uselibpqcompat", "true");
    }

    return url.toString();
  } catch {
    return connectionString;
  }
}

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("Missing DATABASE_URL environment variable");
  }

  if (!global.pgPool) {
    global.pgPool = new Pool({
      connectionString: normalizeConnectionString(connectionString)
    });
  }

  return global.pgPool;
}

export const db = new Proxy({} as Pool, {
  get(_target, prop, receiver) {
    const pool = getPool();
    const value = Reflect.get(pool, prop, receiver);

    if (typeof value === "function") {
      return value.bind(pool);
    }

    return value;
  }
});
