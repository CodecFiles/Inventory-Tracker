import "server-only";
import postgres from "postgres";

// One shared connection pool for the whole server (decision B1: direct PostgreSQL connection).
//
// The database address is a secret: it lives only in server environment variables, never in browser
// code or Git. It is read from DATABASE_URL if set, otherwise from POSTGRES_URL, which the
// Vercel <-> Supabase integration creates and keeps in sync (transaction pooler, port 6543).
// `prepare: false` is required for that pooler. Locally (tests) neither is set and postgres.js uses
// the standard PGHOST / PGPORT / PGUSER / PGDATABASE environment variables instead.

export type Sql = postgres.Sql;

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
    // idle_timeout / max_lifetime: hosted functions pause between requests, and the database's
    // pooler closes connections that sit unused. Closing idle ones ourselves after 10 s (and every
    // connection after 10 min) means a dead one is rarely picked up again; withRetry covers the rest.
    const options = { prepare: false, max: 5, idle_timeout: 10, max_lifetime: 600, connect_timeout: 15 };
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

// A connection that died under us (closed by the pooler while the function was paused, a network
// blip). The query never got an answer, so trying once more on a fresh connection is the fix.
const LOST = new Set(["CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "CONNECT_TIMEOUT", "ECONNRESET", "EPIPE"]);
export const isLostConnection = (error: unknown) =>
  typeof error === "object" && error !== null && LOST.has(String((error as { code?: unknown }).code));

// Runs `work`, and once more if the connection was lost — but only when `safeToRepeat` says so
// for that error (always for reads; for saves only if nothing reached the database yet).
export async function withRetry<T>(work: () => Promise<T>, safeToRepeat: (error: unknown) => boolean = () => true): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!isLostConnection(error) || !safeToRepeat(error)) throw error;
    return work();
  }
}

// ---------------------------------------------------------------------------------------------
// One query per connection at a time.
//
// When every connection is busy, postgres.js sends the next query down a busy connection without
// waiting ("pipelining"). Supabase's transaction pooler (Supavisor) can lose the answer to such a
// query, and the page then waits forever (staging, 2026-10-13; a known Supavisor limitation —
// Supabase's postgres.js guide warns about it). So every piece of database work waits here for a
// free slot, with as many slots as the pool has connections, and runs its queries one after another
// (no Promise.all inside one piece of work): no connection ever has two queries in flight.
//
// postgres.js marks a connection free (ReadyForQuery) before the awaiting code resumes, so a slot
// released here always finds its connection open again.
type Slots = { active: number; waiting: (() => void)[] };
const globalForSlots = globalThis as unknown as { mrdSlots?: Slots };

export async function withConnection<T>(work: () => Promise<T>): Promise<T> {
  const slots = (globalForSlots.mrdSlots ??= { active: 0, waiting: [] });
  const capacity = getSql().options.max;
  while (slots.active >= capacity) await new Promise<void>((resolve) => slots.waiting.push(resolve));
  slots.active++;
  try {
    return await work();
  } finally {
    slots.active--;
    slots.waiting.shift()?.();
  }
}
