import "server-only";
import { z } from "zod";
import { requirePermission, withActor } from "../actor";
import { ValidationError } from "../errors";

// Device preparation ("Device preparation" screen in design/), all in MRD Office:
//   configureRouter  — put a free SIM into a router and record its IP; both become "configured"
//   changeRouterSim  — swap a router's SIM; the old SIM becomes a spare or is retired (owner's choice, R8)
//   listFreeSims     — the SIMs that can be chosen in the Configure window's dropdown
//   serialiseItems   — give serial numbers to counted (hybrid) items such as CO2 sensors
// The database refuses anything unsafe on its own (migrations 0004, 0007); these actions add
// permission checks and clear messages.

const unitId = z.number().int().positive();
const ipAddress = z.union([z.ipv4(), z.ipv6()], { error: "Enter a valid IP address" });

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

export type FreeSim = { unitId: number; iccid: string; phoneNumber: string | null; carrier: string | null; product: string };

export async function listFreeSims(userId: string): Promise<FreeSim[]> {
  return withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "inventory.prepare");
    return tx<FreeSim[]>`
      select u.id::int as "unitId", d.iccid, d.phone_number as "phoneNumber", d.carrier, p.name as product
      from units u
      join products p on p.id = u.product_id and p.is_sim
      join sim_details d on d.unit_id = u.id
      where u.status = 'in_office' and u.location_id = office_location_id()
      order by d.iccid`;
  });
}

export const ConfigureRouterInput = z.object({
  routerUnitId: unitId,
  simUnitId: unitId,
  ipAddress: ipAddress.optional(),
});

export async function configureRouter(userId: string, rawInput: unknown): Promise<{ assignmentId: number }> {
  const input = parse(ConfigureRouterInput, rawInput);
  return withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "inventory.prepare");

    const [current] = await tx`select id from sim_assignments where router_unit_id = ${input.routerUnitId} and ended_at is null`;
    if (current) throw new ValidationError("This router already has a SIM — use Change SIM instead");

    const [row] = await tx<{ id: number }[]>`
      insert into sim_assignments (router_unit_id, sim_unit_id, ip_address, assigned_by)
      values (${input.routerUnitId}, ${input.simUnitId}, ${input.ipAddress ?? null}, ${userId})
      returning id::int`;
    return { assignmentId: row.id };
  });
}

export const ChangeRouterSimInput = z.object({
  routerUnitId: unitId,
  newSimUnitId: unitId,
  ipAddress: ipAddress.optional(),
  // what happens to the SIM taken out (R8): back to the office as a spare, or retired
  oldSim: z.enum(["spare", "retire"]),
});

export async function changeRouterSim(userId: string, rawInput: unknown): Promise<{ assignmentId: number }> {
  const input = parse(ChangeRouterSimInput, rawInput);
  return withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "inventory.prepare");
    // retiring is a write-off, which needs its own permission
    if (input.oldSim === "retire") await requirePermission(tx, userId, "inventory.move");

    // lock the current assignment so two people can't swap the same router's SIM at once
    const [current] = await tx<{ id: number; simUnitId: number }[]>`
      select id::int, sim_unit_id::int as "simUnitId" from sim_assignments
      where router_unit_id = ${input.routerUnitId} and ended_at is null for update`;
    if (!current) throw new ValidationError("This router has no SIM yet — use Configure instead");

    await tx`update sim_assignments set ended_at = now(), ended_by = ${userId} where id = ${current.id}`;

    if (input.oldSim === "spare") {
      await tx`update units set status = 'in_office' where id = ${current.simUnitId} and status = 'configured'`;
    } else {
      await tx`
        insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id, performed_by, note)
        select 'write_off', product_id, id, 1, location_id, ${userId}, 'SIM retired when swapped out of router'
        from units where id = ${current.simUnitId}`;
    }

    const [row] = await tx<{ id: number }[]>`
      insert into sim_assignments (router_unit_id, sim_unit_id, ip_address, assigned_by)
      values (${input.routerUnitId}, ${input.newSimUnitId}, ${input.ipAddress ?? null}, ${userId})
      returning id::int`;
    return { assignmentId: row.id };
  });
}

export const SerialiseItemsInput = z.object({
  batchLineId: z.number().int().positive(),
  serials: z.array(z.string().trim().min(1).max(100)).min(1).max(1000),
});

export async function serialiseItems(userId: string, rawInput: unknown): Promise<{ unitsCreated: number }> {
  const input = parse(SerialiseItemsInput, rawInput);
  if (new Set(input.serials).size !== input.serials.length) {
    throw new ValidationError("The same serial number is entered twice");
  }
  return withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "inventory.prepare");

    const [line] = await tx<{ productId: number; batchId: number; tracking: string; name: string }[]>`
      select bl.product_id::int as "productId", bl.batch_id::int as "batchId", p.tracking_type::text as tracking, p.name
      from batch_lines bl join products p on p.id = bl.product_id where bl.id = ${input.batchLineId}`;
    if (!line) throw new ValidationError("That batch line does not exist");
    if (line.tracking !== "hybrid") {
      throw new ValidationError(`${line.name}: only counted items that get serials later (hybrid) can be serialised`);
    }

    // Each serial becomes a unit and takes one item out of the office's counted balance.
    // The database refuses more units than were received, or more than are left in the office.
    for (const serial of input.serials) {
      const [unit] = await tx<{ id: number }[]>`
        insert into units (product_id, batch_line_id, serial_number)
        values (${line.productId}, ${input.batchLineId}, ${serial})
        returning id::int`;
      await tx`
        insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id, batch_id, performed_by)
        values ('serialise', ${line.productId}, ${unit.id}, 1, office_location_id(), ${line.batchId}, ${userId})`;
    }
    return { unitsCreated: input.serials.length };
  });
}
