import "server-only";
import { z } from "zod";
import { requirePermission, withActor } from "../actor";
import type { Tx } from "../db";

// Shared helpers for read-only queries (the screens' data). Reading needs an approved account and
// "reports.view" (every role has it by default); the audit log needs "audit.view".

export function read<T>(userId: string, action: (tx: Tx) => Promise<T>, permission = "reports.view"): Promise<T> {
  return withActor(userId, async (tx) => {
    await requirePermission(tx, userId, permission);
    return action(tx);
  });
}

// Lists are read a page at a time so a screen never loads thousands of rows at once.
export const Page = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const optionalId = z.number().int().positive().optional();

// Text search: % and _ are wildcards in SQL "like", so a search for "50%" must escape them.
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
