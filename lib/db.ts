import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Missing DATABASE_URL environment variable");
}

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

export const db =
  global.pgPool ??
  new Pool({
    connectionString
  });

if (process.env.NODE_ENV !== "production") {
  global.pgPool = db;
}