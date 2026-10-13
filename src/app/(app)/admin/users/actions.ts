"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/server/action-state";
import { text } from "@/server/form-values";
import { approveUser, rejectUser } from "@/server/users/approval";
import { changeUserRole, setAdminPermission, setUserDisabled } from "@/server/users/manage";
import { requireApprovedUser } from "@/server/session";

// Users & roles forms → src/server/users (permissions checked there and again in the database).

async function done(action: () => Promise<unknown>, message: string): Promise<ActionState> {
  const result = await runAction(action, message);
  if (result?.ok) revalidatePath("/", "layout");
  return result;
}

export async function approve(userId: string, _: ActionState, f: FormData) {
  const actor = await requireApprovedUser();
  return done(() => approveUser(actor.id, { userId, role: text(f, "role") }), "Approved");
}

export async function reject(userId: string) {
  const actor = await requireApprovedUser();
  return done(() => rejectUser(actor.id, userId), "Rejected");
}

export async function setRole(userId: string, _: ActionState, f: FormData) {
  const actor = await requireApprovedUser();
  return done(() => changeUserRole(actor.id, { userId, role: text(f, "role") }), "Role changed");
}

export async function setDisabled(userId: string, disabled: boolean) {
  const actor = await requireApprovedUser();
  return done(() => setUserDisabled(actor.id, { userId, disabled }), disabled ? "Disabled — they can no longer use the app" : "Enabled again");
}

// The ticked boxes are the Admin's permissions from now on: add what was ticked, remove what was not.
export async function savePermissions(userId: string, current: string[], _: ActionState, f: FormData) {
  const actor = await requireApprovedUser();
  const wanted = new Set(f.getAll("permission").map(String));
  return done(async () => {
    for (const key of wanted) if (!current.includes(key)) await setAdminPermission(actor.id, { userId, permission: key, granted: true });
    for (const key of current) if (!wanted.has(key)) await setAdminPermission(actor.id, { userId, permission: key, granted: false });
  }, "Permissions saved");
}
