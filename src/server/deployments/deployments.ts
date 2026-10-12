import "server-only";
import { z } from "zod";
import { requirePermission, withActor } from "../actor";
import type { Tx } from "../db";
import { parseInput, ValidationError } from "../errors";
import { assertEnoughStock, assertSimNotInRouter } from "../inventory/stock";

// Deployments ("Create deployment" / "Deployments" screens in design/).
//
// A deployment is a document: it is drafted (and optionally scheduled) freely, and stock only moves
// when it is completed. Completion is one database function (complete_deployment, migration 0004)
// that moves every item — and every router's SIM — in one transaction: all or nothing.
//
// Where items come from:
//   facility in Oman     -> from MRD Office
//   facility abroad      -> from the partner's stock (items shipped to the partner earlier)

const id = z.number().int().positive();
const CLOSED = "This facility is closed — re-open it (move it to POC or Contract) before deploying to it";
const date = z.iso.date();

export const CreateDeploymentInput = z.object({
  facilityId: id,
  type: z.enum(["poc", "contract"]),
  deploymentDate: date.optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createDeployment(userId: string, rawInput: unknown): Promise<{ deploymentId: number; code: string }> {
  const input = parseInput(CreateDeploymentInput, rawInput);
  return withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "deployments.create");
    const [facility] = await tx`select is_active, stage::text from facilities where id = ${input.facilityId}`;
    if (!facility?.is_active) throw new ValidationError("That facility does not exist or is archived");
    if (facility.stage === "closed") throw new ValidationError(CLOSED);

    const [row] = await tx<{ id: number; code: string }[]>`
      insert into deployments (facility_id, deployment_type, deployment_date, created_by, notes)
      values (${input.facilityId}, ${input.type}, ${input.deploymentDate ?? null}, ${userId}, ${input.notes ?? null})
      returning id::int, code`;
    return { deploymentId: row.id, code: row.code };
  });
}

// One line: either one exact unit (router, serialised sensor) or a counted quantity (cables).
export const AddDeploymentItemInput = z.union([
  z.object({ deploymentId: id, unitId: id, building: z.string().trim().max(200).optional(), position: z.string().trim().max(200).optional() }),
  z.object({ deploymentId: id, productId: id, quantity: z.number().int().positive().max(10_000),
             building: z.string().trim().max(200).optional(), position: z.string().trim().max(200).optional() }),
]);

type Source = { deploymentId: number; status: string; abroad: boolean; fromLocationId: number | null };

// Where this deployment's items must come from, with the deployment row locked.
async function deploymentSource(tx: Tx, deploymentId: number): Promise<Source> {
  const [d] = await tx<Source[]>`
    select d.id::int as "deploymentId", d.status::text as status, c.iso_code <> 'OM' as abroad,
           case when c.iso_code = 'OM' then office_location_id()
                else (select l.id from locations l where l.partner_id = f.partner_id) end::int as "fromLocationId"
    from deployments d join facilities f on f.id = d.facility_id join countries c on c.id = f.country_id
    where d.id = ${deploymentId} for update of d`;
  if (!d) throw new ValidationError("That deployment does not exist");
  if (d.status !== "draft" && d.status !== "scheduled") {
    throw new ValidationError(`This deployment is ${d.status} and can no longer be changed`);
  }
  return d;
}

export async function addDeploymentItem(userId: string, rawInput: unknown): Promise<{ itemId: number }> {
  const input = parseInput(AddDeploymentItemInput, rawInput);
  return withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "deployments.create");
    const source = await deploymentSource(tx, input.deploymentId);

    if ("unitId" in input) {
      const [unit] = await tx<{ productId: number; serial: string; status: string; locationId: number;
                                 needsConfig: boolean; isSim: boolean }[]>`
        select u.product_id::int as "productId", u.serial_number as serial, u.status::text as status,
               u.location_id::int as "locationId", p.requires_configuration as "needsConfig", p.is_sim as "isSim"
        from units u join products p on p.id = u.product_id where u.id = ${input.unitId}`;
      if (!unit) throw new ValidationError("That unit does not exist");
      if (unit.isSim) await assertSimNotInRouter(tx, input.unitId, unit.serial);
      if (unit.locationId !== source.fromLocationId) {
        throw new ValidationError(source.abroad
          ? `${unit.serial} is not in the partner's stock — ship it to the partner first`
          : `${unit.serial} is not in MRD Office`);
      }
      const usable = source.abroad ? ["shipped_to_partner"] : ["in_office", "configured"];
      if (!usable.includes(unit.status)) {
        throw new ValidationError(`${unit.serial} is ${unit.status.replaceAll("_", " ")} and cannot be deployed`);
      }
      // Oman: routers must be configured first (lifecycle M1). Abroad: the partner configures them (R10).
      if (!source.abroad && unit.needsConfig && unit.status !== "configured") {
        throw new ValidationError(`Router ${unit.serial} is not configured yet — give it a SIM first`);
      }

      const [row] = await tx<{ id: number }[]>`
        insert into deployment_items (deployment_id, product_id, unit_id, building, position)
        values (${input.deploymentId}, ${unit.productId}, ${input.unitId}, ${input.building ?? null}, ${input.position ?? null})
        returning id::int`;
      return { itemId: row.id };
    }

    const [row] = await tx<{ id: number }[]>`
      insert into deployment_items (deployment_id, product_id, quantity, building, position)
      values (${input.deploymentId}, ${input.productId}, ${input.quantity}, ${input.building ?? null}, ${input.position ?? null})
      returning id::int`;
    return { itemId: row.id };
  });
}

export async function removeDeploymentItem(userId: string, rawInput: unknown): Promise<void> {
  const { itemId } = parseInput(z.object({ itemId: id }), rawInput);
  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "deployments.create");
    const [item] = await tx<{ deploymentId: number }[]>`
      select deployment_id::int as "deploymentId" from deployment_items where id = ${itemId}`;
    if (!item) throw new ValidationError("That item is not on any deployment");
    await deploymentSource(tx, item.deploymentId);
    await tx`delete from deployment_items where id = ${itemId}`;
  });
}

export async function scheduleDeployment(userId: string, rawInput: unknown): Promise<void> {
  const input = parseInput(z.object({ deploymentId: id, deploymentDate: date }), rawInput);
  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "deployments.create");
    await deploymentSource(tx, input.deploymentId);
    await tx`update deployments set status = 'scheduled', deployment_date = ${input.deploymentDate}
             where id = ${input.deploymentId}`;
  });
}

export async function cancelDeployment(userId: string, rawInput: unknown): Promise<void> {
  const { deploymentId } = parseInput(z.object({ deploymentId: id }), rawInput);
  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "deployments.create");
    await deploymentSource(tx, deploymentId);
    // the database frees every unit on it for other deployments (release_cancelled_items)
    await tx`update deployments set status = 'cancelled' where id = ${deploymentId}`;
  });
}

export async function completeDeployment(userId: string, rawInput: unknown): Promise<void> {
  const input = parseInput(z.object({ deploymentId: id, date: date.optional() }), rawInput);
  const today = new Date().toISOString().slice(0, 10);
  if (input.date && input.date > today) throw new ValidationError("A deployment cannot be completed with a future date");

  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, "deployments.complete");
    const source = await deploymentSource(tx, input.deploymentId);

    // a draft made before the facility was closed must wait until it is re-opened (A9)
    const [{ stage }] = await tx<{ stage: string }[]>`
      select f.stage::text from deployments d join facilities f on f.id = d.facility_id where d.id = ${input.deploymentId}`;
    if (stage === "closed") throw new ValidationError(CLOSED);

    // Friendly checks first; the database repeats them inside complete_deployment and has the final say.
    if (!source.abroad) {
      const notReady = await tx<{ serial: string }[]>`
        select u.serial_number as serial from deployment_items i
        join units u on u.id = i.unit_id join products p on p.id = u.product_id
        where i.deployment_id = ${input.deploymentId} and i.removed_at is null
          and p.requires_configuration and u.status <> 'configured'`;
      if (notReady.length) {
        throw new ValidationError(`Not configured: ${notReady.map((r) => r.serial).join(", ")} — give them a SIM first`);
      }
    }
    const counted = await tx<{ name: string; productId: number; quantity: number }[]>`
      select p.name, i.product_id::int as "productId", i.quantity from deployment_items i
      join products p on p.id = i.product_id
      where i.deployment_id = ${input.deploymentId} and i.removed_at is null and i.unit_id is null`;
    await assertEnoughStock(tx, source.fromLocationId, counted);

    await tx`select complete_deployment(${input.deploymentId}, ${userId}, ${input.date ?? null})`;
  });
}
