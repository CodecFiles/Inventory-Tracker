import "server-only";
import { z } from "zod";
import { requirePermission, withActor } from "../actor";
import { ValidationError } from "../errors";

// Receive a delivery into MRD Office ("Receive Inventory" screen in design/).
//
// One delivery = one batch. Each line is one product:
//   serialised products (routers, SIMs) -> one serial per item, each becomes a unit
//   quantity products (cables)           -> no serials, counted into the office balance
//   hybrid products (CO2 sensors)        -> counted now, serials are added during preparation
//   SIM products (is_sim)                 -> serialised; each serial is the SIM's ICCID (18–22 digits)

export const ReceiveDeliveryInput = z.object({
  supplierId: z.number().int().positive(),
  receivedOn: z.iso.date(),
  purchaseOrder: z.string().trim().max(100).optional(),
  invoiceNumber: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive().max(10_000),
        serials: z.array(z.string().trim().min(1).max(100)).optional(),
        // SIM products only: phone numbers in the same order as the ICCIDs, and the carrier
        phoneNumbers: z.array(z.string().trim().max(30)).optional(),
        carrier: z.string().trim().max(100).optional(),
      }),
    )
    .min(1, "Add at least one product")
    .max(200),
});

export type ReceiveDeliveryInput = z.infer<typeof ReceiveDeliveryInput>;

export type ReceiveDeliveryResult = { batchId: number; code: string; unitsCreated: number };

export async function receiveDelivery(userId: string, rawInput: unknown): Promise<ReceiveDeliveryResult> {
  // 1. Check the shape of the input before touching the database.
  const parsed = ReceiveDeliveryInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const input = parsed.data;

  const productIds = input.lines.map((l) => l.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw new ValidationError("Each product can appear only once per delivery — combine the lines");
  }

  // 2. Everything below is one transaction: if any line fails, nothing from this delivery is saved.
  return withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "inventory.receive");

    const products = await tx<{ id: number; name: string; tracking_type: string; is_sim: boolean }[]>`
      select id::int, name, tracking_type::text, is_sim from products
      where id in ${tx(productIds)} and is_active`;
    const byId = new Map(products.map((p) => [p.id, p]));

    // 3. Business rules that depend on the product type.
    for (const line of input.lines) {
      const product = byId.get(line.productId);
      if (!product) throw new ValidationError(`Product ${line.productId} does not exist or is archived`);
      const serials = line.serials ?? [];
      if (product.tracking_type === "serialised") {
        if (serials.length !== line.quantity) {
          throw new ValidationError(
            `${product.name}: ${line.quantity} received but ${serials.length} serial numbers entered`,
          );
        }
        if (new Set(serials).size !== serials.length) {
          throw new ValidationError(`${product.name}: the same serial number is entered twice`);
        }
      } else if (serials.length > 0) {
        throw new ValidationError(`${product.name}: serial numbers are not recorded at receiving for this product`);
      }
      if (product.is_sim) {
        const bad = serials.find((s) => !/^[0-9]{18,22}$/.test(s));
        if (bad) throw new ValidationError(`${product.name}: "${bad}" is not an ICCID (18–22 digits)`);
        if (line.phoneNumbers && line.phoneNumbers.length !== serials.length) {
          throw new ValidationError(`${product.name}: enter one phone number per SIM, or none`);
        }
      } else if (line.phoneNumbers || line.carrier) {
        throw new ValidationError(`${product.name}: phone number and carrier are only for SIM cards`);
      }
    }

    const [batch] = await tx<{ id: number; code: string }[]>`
      insert into batches (supplier_id, received_on, received_by, purchase_order, invoice_number, notes)
      values (${input.supplierId}, ${input.receivedOn}, ${userId},
              ${input.purchaseOrder ?? null}, ${input.invoiceNumber ?? null}, ${input.notes ?? null})
      returning id::int, code`;

    let unitsCreated = 0;
    for (const line of input.lines) {
      const product = byId.get(line.productId)!;
      const [batchLine] = await tx<{ id: number }[]>`
        insert into batch_lines (batch_id, product_id, quantity_received)
        values (${batch.id}, ${line.productId}, ${line.quantity})
        returning id::int`;

      if (product.tracking_type === "serialised") {
        for (const [i, serial] of line.serials!.entries()) {
          const [unit] = await tx<{ id: number }[]>`
            insert into units (product_id, batch_line_id, serial_number)
            values (${line.productId}, ${batchLine.id}, ${serial})
            returning id::int`;
          if (product.is_sim) {
            await tx`
              insert into sim_details (unit_id, iccid, phone_number, carrier)
              values (${unit.id}, ${serial}, ${line.phoneNumbers?.[i] || null}, ${line.carrier || null})`;
          }
          await tx`
            insert into stock_movements (movement_type, product_id, unit_id, quantity, to_location_id, batch_id, performed_by)
            values ('receive', ${line.productId}, ${unit.id}, 1, office_location_id(), ${batch.id}, ${userId})`;
          unitsCreated++;
        }
      } else {
        await tx`
          insert into stock_movements (movement_type, product_id, quantity, to_location_id, batch_id, performed_by)
          values ('receive', ${line.productId}, ${line.quantity}, office_location_id(), ${batch.id}, ${userId})`;
      }
    }

    return { batchId: batch.id, code: batch.code, unitsCreated };
  });
}
