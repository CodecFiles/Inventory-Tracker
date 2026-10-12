"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionState } from "@/server/action-state";
import {
  addDeploymentItem, cancelDeployment, completeDeployment, createDeployment, removeDeploymentItem, scheduleDeployment,
} from "@/server/deployments/deployments";
import { num, text } from "@/server/form-values";
import { requireApprovedUser } from "@/server/session";

// Deployment forms → src/server/deployments (permissions, the configured-router rule, stock checks,
// all-or-nothing completion).

async function done(action: () => Promise<unknown>, message: string): Promise<ActionState> {
  const result = await runAction(action, message);
  if (result?.ok) revalidatePath("/", "layout");
  return result;
}

export async function newDeployment(_: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireApprovedUser();
  let id = 0;
  const result = await runAction(async () => {
    id = (await createDeployment(user.id, {
      facilityId: num(f, "facilityId"), type: text(f, "type"), deploymentDate: text(f, "deploymentDate"), notes: text(f, "notes"),
    })).deploymentId;
  }, "Draft created");
  if (!result?.ok) return result;
  revalidatePath("/", "layout");
  redirect(`/deployments/${id}`);
}

export async function addUnit(deploymentId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => addDeploymentItem(user.id, {
    deploymentId, unitId: num(f, "unitId"), building: text(f, "building"), position: text(f, "position"),
  }), "Added");
}

export async function addCounted(deploymentId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => addDeploymentItem(user.id, {
    deploymentId, productId: num(f, "productId"), quantity: num(f, "quantity"), building: text(f, "building"), position: text(f, "position"),
  }), "Added");
}

export async function removeItem(itemId: number) {
  const user = await requireApprovedUser();
  return done(() => removeDeploymentItem(user.id, { itemId }), "Removed");
}

export async function schedule(deploymentId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => scheduleDeployment(user.id, { deploymentId, deploymentDate: text(f, "deploymentDate") }), "Scheduled");
}

export async function cancel(deploymentId: number) {
  const user = await requireApprovedUser();
  return done(() => cancelDeployment(user.id, { deploymentId }), "Cancelled — its items are free again");
}

export async function complete(deploymentId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => completeDeployment(user.id, { deploymentId, date: text(f, "date") }),
              "Completed — everything has moved to the facility");
}
