import "server-only";
import { z } from "zod";
import { withReader } from "../actor";
import type { Sql } from "../db";

// Shared helpers for read-only queries (the screens' data). Reading needs an approved account and
// "reports.view" (every role has it by default); the audit log needs "audit.view".

export function read<T>(userId: string, action: (sql: Sql) => Promise<T>, permission = "reports.view"): Promise<T> {
  return withReader(userId, permission, action);
}

// Runs a read's queries one after another, never side by side: a connection must not have two
// queries in flight (see withConnection in ../db.ts). Results come back in the same order.
export async function inOrder<T extends readonly (() => PromiseLike<unknown>)[]>(
  queries: T,
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: unknown[] = [];
  for (const query of queries) results.push(await query());
  return results as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

// Lists are read a page at a time so a screen never loads thousands of rows at once.
export const Page = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const optionalId = z.number().int().positive().optional();

// Text search: % and _ are wildcards in SQL "like", so a search for "50%" must escape them.
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
