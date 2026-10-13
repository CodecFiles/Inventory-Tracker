"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/server/action-state";
import { num, text } from "@/server/form-values";
import { correctStock, correctUnit } from "@/server/inventory/corrections";
import { requireApprovedUser } from "@/server/session";

// Super Admin corrections → src/server/inventory/corrections.ts (Super Admin only, reason required,
// enforced again by the database — migration 0011).

async function done(action: () => Promise<unknown>, message: string): Promise<ActionState> {
  const result = await runAction(action, message);
  if (result?.ok) revalidatePath("/", "layout");
  return result;
}

export async function fixStock(_: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  const amount = num(f, "amount") ?? 0;
  return done(() => correctStock(user.id, {
    productId: num(f, "productId"), locationId: num(f, "locationId"),
    change: text(f, "direction") === "remove" ? -amount : amount, reason: text(f, "reason") ?? "",
  }), "Correction recorded");
}

export async function fixUnit(unitId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => correctUnit(user.id, {
    unitId, toLocationId: num(f, "locationId"), status: text(f, "status"), reason: text(f, "reason") ?? "",
  }), "Correction recorded");
}
