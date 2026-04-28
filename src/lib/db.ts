import { Pool } from "pg";

const globalForPg = globalThis as unknown as {
  __pgPool?: Pool;
};

export const db: Pool =
  globalForPg.__pgPool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgres://supabase_admin:postgres@localhost:5434/postgres",
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPg.__pgPool = db;
}
