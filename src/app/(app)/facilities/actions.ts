"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionState } from "@/server/action-state";
import { addContact, createRecord, removeContact, updateRecord } from "@/server/catalogue/catalogue";
import { changeFacilityStage } from "@/server/facilities/stages";
import { checked, num, text } from "@/server/form-values";
import { returnFromFacility } from "@/server/inventory/movements";
import { requireApprovedUser } from "@/server/session";

// Facility forms → catalogue, stage and movement functions (each checks permissions and rules).

const facilityFields = (f: FormData) => ({
  name: text(f, "name"), clientId: num(f, "clientId"), countryId: num(f, "countryId"), partnerId: num(f, "partnerId"),
  city: text(f, "city"), address: text(f, "address"), facilityType: text(f, "facilityType"),
});

export async function addFacility(_: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireApprovedUser();
  let id = 0;
  const result = await runAction(async () => { id = (await createRecord(user.id, "facility", facilityFields(f))).id; }, "Facility added");
  if (!result?.ok) return result;
  revalidatePath("/", "layout");
  redirect(`/facilities/${id}`);
}

async function done(action: () => Promise<unknown>, message: string): Promise<ActionState> {
  const result = await runAction(action, message);
  if (result?.ok) revalidatePath("/", "layout");
  return result;
}

export async function editFacility(id: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => updateRecord(user.id, "facility", { id, ...facilityFields(f) }), "Facility saved");
}

export async function addFacilityContact(facilityId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => addContact(user.id, "facility", {
    ownerId: facilityId, name: text(f, "name"), role: text(f, "role"), email: text(f, "email"), phone: text(f, "phone"),
    isPrimary: checked(f, "isPrimary"),
  }), "Contact added");
}

export async function removeFacilityContact(id: number) {
  const user = await requireApprovedUser();
  return done(() => removeContact(user.id, "facility", { id }), "Contact removed");
}

export async function changeStage(facilityId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => changeFacilityStage(user.id, { facilityId, toStage: text(f, "toStage"), reason: text(f, "reason") }),
              "Stage changed");
}

// Return to MRD Office: ticked units, plus a quantity for each counted product
export async function returnItems(facilityId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  const items: ({ unitId: number } | { productId: number; quantity: number })[] =
    f.getAll("unit").map((v) => ({ unitId: Number(v) }));
  for (const [key, value] of f.entries()) {
    if (key.startsWith("qty_") && typeof value === "string" && Number(value) > 0) {
      items.push({ productId: Number(key.slice(4)), quantity: Number(value) });
    }
  }
  return done(() => returnFromFacility(user.id, { facilityId, items, note: text(f, "note") }), "Returned to MRD Office");
}
