import "server-only";
import postgres from "postgres";

// One shared connection pool for the whole server (decision B1: direct PostgreSQL connection).
//
// The database address is a secret: it lives only in server environment variables, never in browser
// code or Git. It is read from DATABASE_URL if set, otherwise from POSTGRES_URL, which the
// Vercel <-> Supabase integration creates and keeps in sync (transaction pooler, port 6543).
// `prepare: false` is required for that pooler. Locally (tests) neither is set and postgres.js uses
// the standard PGHOST / PGPORT / PGUSER / PGDATABASE environment variables instead.

type Sql = postgres.Sql;

const globalForDb = globalThis as unknown as { mrdSql?: Sql };

// Returns the configured address, cleaned for postgres.js: integration URLs carry extra query
// options (e.g. "supa=base-pooler.x") that PostgreSQL would reject, so only sslmode is kept.
export function databaseUrl(): string | null {
  const raw = (process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const sslmode = url.searchParams.get("sslmode");
    url.search = sslmode ? `?sslmode=${sslmode}` : "";
    return url.toString();
  } catch {
    return raw;
  }
}

export function getSql(): Sql {
  if (!globalForDb.mrdSql) {
    const options = { prepare: false, max: 5 };
    const url = databaseUrl();
    if (!url && process.env.VERCEL) {
      // On the hosted site a missing address is a configuration mistake: say so plainly instead of
      // silently trying a database on the server itself (127.0.0.1).
      throw new Error("Database address missing: set DATABASE_URL or POSTGRES_URL in Vercel");
    }
    globalForDb.mrdSql = url ? postgres(url, options) : postgres(options);
  }
  return globalForDb.mrdSql;
}

export type Tx = postgres.TransactionSql;
