import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("Missing DATABASE_URL environment variable");
  }

  if (!global.pgPool) {
    global.pgPool = new Pool({
      connectionString
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
