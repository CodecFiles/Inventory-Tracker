import "server-only";
import { z } from "zod";
import { requireSuperAdmin, withActor } from "../actor";
import { parseInput, ValidationError } from "../errors";
import { assertSimNotInRouter } from "./stock";

// Corrections fix mistakes without rewriting history: each one is a new 'correction' movement with
// a reason, recorded under the Super Admin's name. Only a Super Admin may make them (also enforced
// by the database, migration 0011). Examples: a recount finds 2 more cables; a router was recorded
// at the wrong site; an item written off by mistake is found again.

const reason = z.string().trim().min(3, "Give a reason for the correction").max(2000);

export const CorrectStockInput = z.object({
  productId: z.number().int().positive(),
  locationId: z.number().int().positive(),
  change: z.number().int().refine((n) => n !== 0, "The change cannot be 0").refine((n) => Math.abs(n) <= 10_000),
  reason,
});

// Counted items: add (+) or remove (−) stock at one place.
export async function correctStock(userId: string, rawInput: unknown): Promise<void> {
  const input = parseInput(CorrectStockInput, rawInput);
  await withActor(userId, async (tx) => {
    await requireSuperAdmin(tx, userId);
    const [p] = await tx<{ tracking: string }[]>`select tracking_type::text as tracking from products where id = ${input.productId}`;
    if (!p) throw new ValidationError("That product does not exist");
    if (p.tracking === "serialised") throw new ValidationError("Serialised items are corrected one unit at a time");

    const [from, to] = input.change > 0 ? [null, input.locationId] : [input.locationId, null];
    await tx`
      insert into stock_movements (movement_type, product_id, quantity, from_location_id, to_location_id, performed_by, note)
      values ('correction', ${input.productId}, ${Math.abs(input.change)}, ${from}, ${to}, ${userId}, ${input.reason})`;
  });
}

const STATUSES = ["in_office", "configured", "deployed", "shipped_to_partner", "deployed_abroad",
                  "in_repair", "returned_to_supplier", "retired"] as const;

export const CorrectUnitInput = z.object({
  unitId: z.number().int().positive(),
  toLocationId: z.number().int().positive().optional(),
  status: z.enum(STATUSES),
  reason,
});

// One unit: put it where it really is, with the status it really has.
export async function correctUnit(userId: string, rawInput: unknown): Promise<void> {
  const input = parseInput(CorrectUnitInput, rawInput);
  await withActor(userId, async (tx) => {
    await requireSuperAdmin(tx, userId);
    const [u] = await tx<{ productId: number; serial: string; locationId: number; status: string }[]>`
      select product_id::int as "productId", serial_number as serial, location_id::int as "locationId", status::text as status
      from units where id = ${input.unitId} for update`;
    if (!u) throw new ValidationError("That unit does not exist");
    const moving = input.toLocationId !== undefined && input.toLocationId !== u.locationId;
    if (!moving && input.status === u.status) throw new ValidationError("Nothing to correct — same place and status");
    if (moving) await assertSimNotInRouter(tx, input.unitId, u.serial);

    // a router's SIM is corrected along with it
    const [sim] = moving
      ? await tx<{ simUnitId: number }[]>`
          select sim_unit_id::int as "simUnitId" from sim_assignments where router_unit_id = ${input.unitId} and ended_at is null`
      : [];
    const ids = sim ? [input.unitId, sim.simUnitId] : [input.unitId];

    for (const id of ids) {
      // to_location_id empty = the unit stays where it is (status-only correction)
      await tx`
        insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id, to_location_id, performed_by, note)
        select 'correction', product_id, id, 1, location_id, ${moving ? input.toLocationId! : null}, ${userId},
               ${id === input.unitId ? input.reason : `SIM inside router ${u.serial}: ${input.reason}`}
        from units where id = ${id}`;
      await tx`update units set status = ${input.status} where id = ${id}`;
      // a unit moved away from a site no longer counts as deployed there
      if (moving) {
        await tx`update deployment_items set removed_at = now()
                 where unit_id = ${id} and removed_at is null
                   and deployment_id in (select id from deployments where status = 'completed')`;
      }
    }
  });
}
