import "server-only";
import postgres from "postgres";

// One shared connection pool for the whole server (decision B1: direct PostgreSQL connection).
//
// DATABASE_URL is a secret: it lives only in server environment variables, never in browser code
// or Git. With Supabase, use the "transaction pooler" connection string (port 6543); `prepare:
// false` is required for that pooler. When DATABASE_URL is not set (local tests), postgres.js
// falls back to the standard PGHOST / PGPORT / PGUSER / PGDATABASE environment variables.

type Sql = postgres.Sql;

const globalForDb = globalThis as unknown as { mrdSql?: Sql };

export function getSql(): Sql {
  if (!globalForDb.mrdSql) {
    const options = { prepare: false, max: 5 };
    globalForDb.mrdSql = process.env.DATABASE_URL
      ? postgres(process.env.DATABASE_URL, options)
      : postgres(options);
  }
  return globalForDb.mrdSql;
}

export type Tx = postgres.TransactionSql;
