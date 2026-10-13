"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionState } from "@/server/action-state";
import { num, text } from "@/server/form-values";
import {
  addShipmentItem, cancelShipment, createShipment, markShipmentReceived, removeShipmentItem, shipShipment,
} from "@/server/shipments/shipments";
import { requireApprovedUser } from "@/server/session";

// Shipment forms → src/server/shipments (MRD Office → a partner abroad; all or nothing when shipped).

async function done(action: () => Promise<unknown>, message: string): Promise<ActionState> {
  const result = await runAction(action, message);
  if (result?.ok) revalidatePath("/", "layout");
  return result;
}

export async function newShipment(_: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireApprovedUser();
  let id = 0;
  const result = await runAction(async () => {
    id = (await createShipment(user.id, {
      partnerId: num(f, "partnerId"), courier: text(f, "courier"), trackingNumber: text(f, "trackingNumber"), notes: text(f, "notes"),
    })).shipmentId;
  }, "Draft created");
  if (!result?.ok) return result;
  revalidatePath("/", "layout");
  redirect(`/shipments/${id}`);
}

export async function addUnit(shipmentId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => addShipmentItem(user.id, { shipmentId, unitId: num(f, "unitId") }), "Added");
}

export async function addCounted(shipmentId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => addShipmentItem(user.id, { shipmentId, productId: num(f, "productId"), quantity: num(f, "quantity") }), "Added");
}

export async function removeItem(itemId: number) {
  const user = await requireApprovedUser();
  return done(() => removeShipmentItem(user.id, { itemId }), "Removed");
}

export async function ship(shipmentId: number, _: ActionState, f: FormData) {
  const user = await requireApprovedUser();
  return done(() => shipShipment(user.id, {
    shipmentId, shippedOn: text(f, "shippedOn"), courier: text(f, "courier"), trackingNumber: text(f, "trackingNumber"),
  }), "Shipped — everything is now in the partner's stock");
}

export async function received(shipmentId: number) {
  const user = await requireApprovedUser();
  return done(() => markShipmentReceived(user.id, { shipmentId }), "Marked as received by the partner");
}

export async function cancel(shipmentId: number) {
  const user = await requireApprovedUser();
  return done(() => cancelShipment(user.id, { shipmentId }), "Cancelled");
}
