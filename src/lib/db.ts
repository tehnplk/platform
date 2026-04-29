import { Pool } from "pg";

const globalForPg = globalThis as unknown as {
  __pgPool?: Pool;
};

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Define it in .env.local (dev) or the host environment (prod).",
  );
}

export const db: Pool =
  globalForPg.__pgPool ??
  new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPg.__pgPool = db;
}
