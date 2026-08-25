import { Pool, type PoolConfig } from "pg";

declare global {
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

  if (!global.pgPool) {
    let config: PoolConfig;
    if (connectionString) {
      config = { connectionString: normalizeConnectionString(connectionString) };
    } else if (process.env.PGHOST && process.env.PGUSER && process.env.PGDATABASE) {
      config = {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE
      };
    } else {
      throw new Error("Missing DATABASE_URL or PostgreSQL PG* environment variables");
    }
    global.pgPool = new Pool(config);
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
