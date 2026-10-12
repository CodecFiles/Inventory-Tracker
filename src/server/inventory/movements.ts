import "server-only";
import { z } from "zod";
import { requirePermission, withActor } from "../actor";
import type { Tx } from "../db";
import { parseInput, ValidationError } from "../errors";
import { assertEnoughStock, assertSimNotInRouter } from "./stock";

// Items coming back and going out of use (permission inventory.move):
//   returnFromFacility — items come back from a site in Oman to MRD Office (never from abroad, F10)
//   sendForRepair      — a unit goes to a repair company or to its supplier for repair (Q3)
//   backFromRepair     — it comes back to MRD Office
//   returnToSupplier   — it goes back to the supplier for good (e.g. warranty replacement)
//   writeOff           — it is retired (damaged, lost); a reason is required
//
// SIMs (R8): a router returning from a site brings its SIM back inside it. When a router with a SIM
// goes for repair, back to the supplier or is written off, the person chooses what happens to the
// SIM: kept as a spare, or retired.

const id = z.number().int().positive();
const note = z.string().trim().max(2000).optional();
const simChoice = z.enum(["spare", "retire"]).optional();

type Unit = { id: number; productId: number; serial: string; status: string; locationId: number;
              place: string; abroad: boolean; isSim: boolean };

async function getUnit(tx: Tx, unitId: number): Promise<Unit> {
  const [u] = await tx<Unit[]>`
    select u.id::int, u.product_id::int as "productId", u.serial_number as serial, u.status::text as status,
           u.location_id::int as "locationId", l.type::text as place,
           coalesce((select c.iso_code <> 'OM' from facilities f join countries c on c.id = f.country_id
                     where f.id = l.facility_id), l.type = 'partner_stock') as abroad,
           p.is_sim as "isSim"
    from units u join locations l on l.id = u.location_id join products p on p.id = u.product_id
    where u.id = ${unitId} for update of u`;
  if (!u) throw new ValidationError("That unit does not exist");
  if (u.status === "retired") throw new ValidationError(`${u.serial} is retired`);
  return u;
}

async function moveUnit(tx: Tx, userId: string, type: string, unit: Unit, toLocationId: number | null, text?: string) {
  await tx`
    insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id, to_location_id, performed_by, note)
    values (${type}, ${unit.productId}, ${unit.id}, 1, ${unit.locationId}, ${toLocationId}, ${userId}, ${text ?? null})`;
}

const office = async (tx: Tx) => (await tx<{ id: number }[]>`select office_location_id()::int as id`)[0].id;

// Ends a router's SIM assignment (if it has one) and deals with the SIM as chosen.
// Returns false when the router had no SIM.
export async function takeSimOut(tx: Tx, userId: string, routerUnitId: number, choice: "spare" | "retire" | undefined): Promise<boolean> {
  const [a] = await tx<{ id: number; simUnitId: number; router: string; iccid: string }[]>`
    select a.id::int, a.sim_unit_id::int as "simUnitId", r.serial_number as router, s.serial_number as iccid
    from sim_assignments a join units r on r.id = a.router_unit_id join units s on s.id = a.sim_unit_id
    where a.router_unit_id = ${routerUnitId} and a.ended_at is null for update of a`;
  if (!a) return false;
  if (!choice) {
    throw new ValidationError(`Router ${a.router} has SIM ${a.iccid} inside — choose whether the SIM is kept as a spare or retired`);
  }
  if (choice === "retire") await requirePermission(tx, userId, "inventory.move");

  await tx`update sim_assignments set ended_at = now(), ended_by = ${userId} where id = ${a.id}`;
  const sim = await getUnit(tx, a.simUnitId);
  if (choice === "retire") {
    await moveUnit(tx, userId, "write_off", sim, null, `SIM retired when taken out of router ${a.router}`);
  } else if (sim.place === "facility") {
    // the SIM is brought back to the office as a spare
    await moveUnit(tx, userId, "return", sim, await office(tx), `SIM taken out of router ${a.router}`);
  } else if (sim.place === "office") {
    await tx`update units set status = 'in_office' where id = ${sim.id} and status = 'configured'`;
  }
  // at a partner: the SIM simply becomes free again in the partner's stock
  return true;
}

// ---------------------------------------------------------------------------------------------
export const ReturnFromFacilityInput = z.object({
  facilityId: id,
  items: z.array(z.union([
    z.object({ unitId: id }),
    z.object({ productId: id, quantity: z.number().int().positive().max(10_000) }),
  ])).min(1, "Choose at least one item").max(500),
  note,
});

export async function returnFromFacility(userId: string, rawInput: unknown): Promise<void> {
  const input = parseInput(ReturnFromFacilityInput, rawInput);
  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "inventory.move");
    const [site] = await tx<{ locationId: number; abroad: boolean }[]>`
      select l.id::int as "locationId", c.iso_code <> 'OM' as abroad
      from facilities f join locations l on l.facility_id = f.id join countries c on c.id = f.country_id
      where f.id = ${input.facilityId}`;
    if (!site) throw new ValidationError("That facility does not exist");
    if (site.abroad) throw new ValidationError("Items are not returned from abroad (F10) — a Super Admin correction is needed");
    const officeId = await office(tx);

    const counted = [];
    for (const item of input.items) {
      if (!("unitId" in item)) {
        const [p] = await tx<{ name: string }[]>`select name from products where id = ${item.productId}`;
        counted.push({ name: p?.name ?? `Product ${item.productId}`, productId: item.productId, quantity: item.quantity });
        continue;
      }
      const unit = await getUnit(tx, item.unitId);
      if (unit.locationId !== site.locationId) throw new ValidationError(`${unit.serial} is not at this facility`);
      if (unit.isSim) await assertSimNotInRouter(tx, unit.id, unit.serial);
      await moveUnit(tx, userId, "return", unit, officeId, input.note);

      // the router's SIM comes back inside it; both are ready to deploy again
      const [sim] = await tx<{ simUnitId: number }[]>`
        select sim_unit_id::int as "simUnitId" from sim_assignments where router_unit_id = ${unit.id} and ended_at is null`;
      if (sim) {
        await moveUnit(tx, userId, "return", await getUnit(tx, sim.simUnitId), officeId, `SIM inside router ${unit.serial}`);
        await tx`update units set status = 'configured' where id in (${unit.id}, ${sim.simUnitId})`;
      }
    }

    await assertEnoughStock(tx, site.locationId, counted);
    for (const c of counted) {
      await tx`
        insert into stock_movements (movement_type, product_id, quantity, from_location_id, to_location_id, performed_by, note)
        values ('return', ${c.productId}, ${c.quantity}, ${site.locationId}, ${officeId}, ${userId}, ${input.note ?? null})`;
    }
  });
}

// ---------------------------------------------------------------------------------------------
export const SendForRepairInput = z.object({
  unitId: id,
  repairCompanyId: id.optional(),
  supplierId: id.optional(),
  sim: simChoice,
  note,
}).refine((v) => (v.repairCompanyId === undefined) !== (v.supplierId === undefined), {
  message: "Choose either a repair company or a supplier",
});

export async function sendForRepair(userId: string, rawInput: unknown): Promise<void> {
  const input = parseInput(SendForRepairInput, rawInput);
  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "inventory.move");
    const unit = await getUnit(tx, input.unitId);
    if (unit.isSim) await assertSimNotInRouter(tx, unit.id, unit.serial);
    const [to] = await tx<{ id: number }[]>`
      select id::int from locations
      where ${input.repairCompanyId ? tx`repair_company_id = ${input.repairCompanyId}` : tx`supplier_id = ${input.supplierId!}`}`;
    if (!to) throw new ValidationError("That repair company or supplier does not exist");

    if (unit.abroad || !["office", "facility"].includes(unit.place)) {
      throw new ValidationError(`${unit.serial}: only items in MRD Office or at a site in Oman can be sent for repair`);
    }

    await takeSimOut(tx, userId, unit.id, input.sim);
    await moveUnit(tx, userId, "send_repair", unit, to.id, input.note);
  });
}

export async function backFromRepair(userId: string, rawInput: unknown): Promise<void> {
  const input = parseInput(z.object({ unitId: id, note }), rawInput);
  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "inventory.move");
    const unit = await getUnit(tx, input.unitId);
    if (unit.status !== "in_repair") throw new ValidationError(`${unit.serial} is not in repair`);
    await moveUnit(tx, userId, "back_from_repair", unit, await office(tx), input.note);
  });
}

export async function returnToSupplier(userId: string, rawInput: unknown): Promise<void> {
  const input = parseInput(z.object({ unitId: id, supplierId: id, sim: simChoice, note }), rawInput);
  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "inventory.move");
    const unit = await getUnit(tx, input.unitId);
    if (unit.isSim) await assertSimNotInRouter(tx, unit.id, unit.serial);
    const [to] = await tx<{ id: number }[]>`select id::int from locations where supplier_id = ${input.supplierId}`;
    if (!to) throw new ValidationError("That supplier does not exist");

    if (!["office", "repair_company"].includes(unit.place)) {
      throw new ValidationError(`${unit.serial}: bring it back to MRD Office first`);
    }

    await takeSimOut(tx, userId, unit.id, input.sim);
    await moveUnit(tx, userId, "return_to_supplier", unit, to.id, input.note);
  });
}

// ---------------------------------------------------------------------------------------------
const reason = z.string().trim().min(3, "Give a reason for the write-off").max(2000);

export const WriteOffInput = z.union([
  z.object({ unitId: id, sim: simChoice, reason }),
  // counted items: from MRD Office, or from a facility when given
  z.object({ productId: id, quantity: z.number().int().positive().max(10_000), facilityId: id.optional(), reason }),
]);

export async function writeOff(userId: string, rawInput: unknown): Promise<void> {
  const input = parseInput(WriteOffInput, rawInput);
  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "inventory.move");

    if ("unitId" in input) {
      const unit = await getUnit(tx, input.unitId);
      if (unit.isSim) await assertSimNotInRouter(tx, unit.id, unit.serial);
      await takeSimOut(tx, userId, unit.id, input.sim);
      await moveUnit(tx, userId, "write_off", unit, null, input.reason);
      return;
    }

    const [from] = input.facilityId
      ? await tx<{ id: number }[]>`select id::int from locations where facility_id = ${input.facilityId}`
      : await tx<{ id: number }[]>`select office_location_id()::int as id`;
    if (!from) throw new ValidationError("That facility does not exist");
    const [p] = await tx<{ name: string }[]>`select name from products where id = ${input.productId}`;
    if (!p) throw new ValidationError("That product does not exist");
    await assertEnoughStock(tx, from.id, [{ name: p.name, productId: input.productId, quantity: input.quantity }]);
    await tx`
      insert into stock_movements (movement_type, product_id, quantity, from_location_id, performed_by, note)
      values ('write_off', ${input.productId}, ${input.quantity}, ${from.id}, ${userId}, ${input.reason})`;
  });
}
