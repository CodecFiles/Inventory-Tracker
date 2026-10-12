"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/server/action-state";
import { lines, num, text } from "@/server/form-values";
import { changeRouterSim, configureRouter, serialiseItems } from "@/server/inventory/prepare";
import { requireApprovedUser } from "@/server/session";

// Device preparation forms → src/server/inventory/prepare.ts (which checks permissions and rules).

async function done(action: () => Promise<unknown>, message: string): Promise<ActionState> {
  const result = await runAction(action, message);
  if (result?.ok) revalidatePath("/", "layout");
  return result;
}

export async function configure(routerUnitId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => configureRouter(user.id, { routerUnitId, simUnitId: num(f, "simUnitId"), ipAddress: text(f, "ipAddress") }),
              "SIM put in — the router is ready");
}

export async function changeSim(routerUnitId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => changeRouterSim(user.id, {
    routerUnitId, newSimUnitId: num(f, "simUnitId"), ipAddress: text(f, "ipAddress"), oldSim: text(f, "oldSim"),
  }), "SIM changed");
}

export async function serialise(batchLineId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => serialiseItems(user.id, { batchLineId, serials: lines(f, "serials") }), "Serial numbers saved");
}
