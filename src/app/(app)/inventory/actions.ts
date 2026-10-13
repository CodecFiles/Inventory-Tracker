"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/server/action-state";
import { num, text } from "@/server/form-values";
import { backFromRepair, returnToSupplier, sendForRepair, writeOff } from "@/server/inventory/movements";
import { requireApprovedUser } from "@/server/session";

// Item-page actions → src/server/inventory/movements.ts (permission inventory.move; SIM choice R8/R11).

async function done(action: () => Promise<unknown>, message: string): Promise<ActionState> {
  const result = await runAction(action, message);
  if (result?.ok) revalidatePath("/", "layout");
  return result;
}

export async function repair(unitId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  const [kind, id] = (text(f, "to") ?? ":").split(":");
  return done(() => sendForRepair(user.id, {
    unitId, sim: text(f, "sim"), note: text(f, "note"),
    ...(kind === "repair" ? { repairCompanyId: Number(id) } : { supplierId: Number(id) }),
  }), "Sent for repair");
}

export async function backFrom(unitId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => backFromRepair(user.id, { unitId, note: text(f, "note") }), "Back in MRD Office");
}

export async function toSupplier(unitId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => returnToSupplier(user.id, { unitId, supplierId: num(f, "supplierId"), sim: text(f, "sim"), note: text(f, "note") }),
              "Returned to the supplier");
}

export async function retire(unitId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => writeOff(user.id, { unitId, sim: text(f, "sim"), reason: text(f, "reason") ?? "" }), "Written off");
}
