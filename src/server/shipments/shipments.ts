import "server-only";
import { z } from "zod";
import { requirePermission, withActor } from "../actor";
import type { Tx } from "../db";
import { parseInput, ValidationError } from "../errors";
import { assertEnoughStock, assertSimNotInRouter } from "../inventory/stock";

// Shipments: MRD Office -> a partner company abroad. Like deployments, a shipment is drafted freely
// and stock only moves when it is shipped (database function ship_shipment, all or nothing; a
// configured router's SIM travels with it). Routers may be shipped unconfigured, together with
// loose SIMs, for the partner to configure in their country (R10).
//
// Status: draft -> shipped -> received_by_partner   (or draft -> cancelled)

const id = z.number().int().positive();
const text = (max: number) => z.string().trim().max(max).optional();

export const CreateShipmentInput = z.object({
  partnerId: id,
  courier: text(100),
  trackingNumber: text(100),
  notes: text(2000),
});

export async function createShipment(userId: string, rawInput: unknown): Promise<{ shipmentId: number; code: string }> {
  const input = parseInput(CreateShipmentInput, rawInput);
  return withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "shipments.manage");
    const [partner] = await tx`select is_active from partners where id = ${input.partnerId}`;
    if (!partner?.is_active) throw new ValidationError("That partner does not exist or is archived");

    const [row] = await tx<{ id: number; code: string }[]>`
      insert into shipments (partner_id, courier, tracking_number, created_by, notes)
      values (${input.partnerId}, ${input.courier ?? null}, ${input.trackingNumber ?? null}, ${userId}, ${input.notes ?? null})
      returning id::int, code`;
    return { shipmentId: row.id, code: row.code };
  });
}

// Locks the shipment and checks it is in the expected status.
async function lockShipment(tx: Tx, shipmentId: number, expected: string): Promise<void> {
  const [s] = await tx<{ status: string }[]>`select status::text from shipments where id = ${shipmentId} for update`;
  if (!s) throw new ValidationError("That shipment does not exist");
  if (s.status !== expected) {
    throw new ValidationError(`This shipment is ${s.status.replaceAll("_", " ")}` +
      (expected === "draft" ? " and can no longer be changed" : ""));
  }
}

export const AddShipmentItemInput = z.union([
  z.object({ shipmentId: id, unitId: id }),
  z.object({ shipmentId: id, productId: id, quantity: z.number().int().positive().max(10_000) }),
]);

export async function addShipmentItem(userId: string, rawInput: unknown): Promise<{ itemId: number }> {
  const input = parseInput(AddShipmentItemInput, rawInput);
  return withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "shipments.manage");
    await lockShipment(tx, input.shipmentId, "draft");

    if ("unitId" in input) {
      const [unit] = await tx<{ productId: number; serial: string; status: string; inOffice: boolean; isSim: boolean }[]>`
        select u.product_id::int as "productId", u.serial_number as serial, u.status::text as status,
               u.location_id = office_location_id() as "inOffice", p.is_sim as "isSim"
        from units u join products p on p.id = u.product_id where u.id = ${input.unitId}`;
      if (!unit) throw new ValidationError("That unit does not exist");
      if (!unit.inOffice || !["in_office", "configured"].includes(unit.status)) {
        throw new ValidationError(`${unit.serial} is not available in MRD Office`);
      }
      if (unit.isSim) await assertSimNotInRouter(tx, input.unitId, unit.serial);

      const [row] = await tx<{ id: number }[]>`
        insert into shipment_items (shipment_id, product_id, unit_id)
        values (${input.shipmentId}, ${unit.productId}, ${input.unitId}) returning id::int`;
      return { itemId: row.id };
    }

    const [row] = await tx<{ id: number }[]>`
      insert into shipment_items (shipment_id, product_id, quantity)
      values (${input.shipmentId}, ${input.productId}, ${input.quantity}) returning id::int`;
    return { itemId: row.id };
  });
}

export async function removeShipmentItem(userId: string, rawInput: unknown): Promise<void> {
  const { itemId } = parseInput(z.object({ itemId: id }), rawInput);
  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "shipments.manage");
    const [item] = await tx<{ shipmentId: number }[]>`select shipment_id::int as "shipmentId" from shipment_items where id = ${itemId}`;
    if (!item) throw new ValidationError("That item is not on any shipment");
    await lockShipment(tx, item.shipmentId, "draft");
    await tx`delete from shipment_items where id = ${itemId}`;
  });
}

export async function cancelShipment(userId: string, rawInput: unknown): Promise<void> {
  const { shipmentId } = parseInput(z.object({ shipmentId: id }), rawInput);
  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "shipments.manage");
    await lockShipment(tx, shipmentId, "draft");
    await tx`update shipments set status = 'cancelled' where id = ${shipmentId}`;
  });
}

export const ShipShipmentInput = z.object({
  shipmentId: id,
  shippedOn: z.iso.date().optional(),
  courier: text(100),
  trackingNumber: text(100),
});

export async function shipShipment(userId: string, rawInput: unknown): Promise<void> {
  const input = parseInput(ShipShipmentInput, rawInput);
  const today = new Date().toISOString().slice(0, 10);
  if (input.shippedOn && input.shippedOn > today) throw new ValidationError("The ship date cannot be in the future");

  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "shipments.manage");
    await lockShipment(tx, input.shipmentId, "draft");

    const counted = await tx<{ name: string; productId: number; quantity: number }[]>`
      select p.name, i.product_id::int as "productId", i.quantity from shipment_items i
      join products p on p.id = i.product_id
      where i.shipment_id = ${input.shipmentId} and i.removed_at is null and i.unit_id is null`;
    const [{ office }] = await tx<{ office: number }[]>`select office_location_id()::int as office`;
    await assertEnoughStock(tx, office, counted);

    if (input.courier || input.trackingNumber) {
      await tx`update shipments set courier = coalesce(${input.courier ?? null}, courier),
                                    tracking_number = coalesce(${input.trackingNumber ?? null}, tracking_number)
               where id = ${input.shipmentId}`;
    }
    await tx`select ship_shipment(${input.shipmentId}, ${userId}, ${input.shippedOn ?? null})`;
  });
}

// The partner confirms the goods arrived (stock already counts as theirs since shipping).
export async function markShipmentReceived(userId: string, rawInput: unknown): Promise<void> {
  const { shipmentId } = parseInput(z.object({ shipmentId: id }), rawInput);
  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "shipments.manage");
    await lockShipment(tx, shipmentId, "shipped");
    await tx`update shipments set status = 'received_by_partner' where id = ${shipmentId}`;
  });
}
