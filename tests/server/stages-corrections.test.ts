// Backend tests for facility stage changes (R12) and Super Admin corrections.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSql } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { addDeploymentItem, completeDeployment, createDeployment } from "@/server/deployments/deployments";
import { changeFacilityStage } from "@/server/facilities/stages";
import { correctStock, correctUnit } from "@/server/inventory/corrections";
import { writeOff } from "@/server/inventory/movements";
import { configureRouter } from "@/server/inventory/prepare";
import { receiveDelivery } from "@/server/inventory/receive";

const sql = getSql();

const EDITOR = "6f1c2a3e-0000-4000-8000-0000000005c1";
const ADMIN = "6f1c2a3e-0000-4000-8000-0000000005c2";
const SUPER = "6f1c2a3e-0000-4000-8000-0000000005c3";
const VIEWER = "6f1c2a3e-0000-4000-8000-0000000005c4";

let site: number;
let cable: number;
let officeId: number;
const unit: Record<string, number> = {};

const today = new Date().toISOString().slice(0, 10);
const stageOf = async () => (await sql`select stage::text from facilities where id = ${site}`)[0].stage as string;
const where = async (serial: string) =>
  (await sql`select l.type::text as type, u.status::text as status from units u join locations l on l.id = u.location_id
             where u.id = ${unit[serial]}`)[0];
const officeCables = async () =>
  (await sql`select coalesce(sum(quantity), 0)::int as q from stock_levels
             where product_id = ${cable} and location_id = office_location_id()`)[0].q as number;

beforeAll(async () => {
  await sql`insert into auth.users (id) values (${EDITOR}), (${ADMIN}), (${SUPER}), (${VIEWER})`;
  await sql`insert into users (id, email, full_name, role, status) values
    (${EDITOR}, 'sc-editor@moonrock.om', 'SC Editor', 'editor', 'approved'),
    (${ADMIN}, 'sc-admin@moonrock.om', 'SC Admin', 'admin', 'approved'),
    (${SUPER}, 'sc-super@moonrock.om', 'SC Super', 'super_admin', 'approved'),
    (${VIEWER}, 'sc-viewer@gmail.com', 'SC Viewer', 'viewer', 'approved')`;
  // the Super Admin gives the Admin the stage permission (only a Super Admin may grant it)
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${SUPER}, true)`;
    await tx`insert into user_permissions (user_id, permission_key, granted_by) values (${ADMIN}, 'facilities.change_stage', ${SUPER})`;
  });

  const [{ id: supplierId }] = await sql`insert into suppliers (name, code_prefix) values ('SC Supplier', 'SCS') returning id::int`;
  const [{ id: cat }] = await sql`insert into categories (name) values ('SC test') returning id::int`;
  const [{ id: router }] = await sql`insert into products (name, brand, model, category_id, tracking_type, requires_configuration)
    values ('TRB router', 'Teltonika', 'TRB-SC', ${cat}, 'serialised', true) returning id::int`;
  const [{ id: sim }] = await sql`insert into products (name, brand, model, category_id, tracking_type, is_sim)
    values ('Data SIM', 'Omantel', 'SIM-SC', ${cat}, 'serialised', true) returning id::int`;
  const [{ id: sensor }] = await sql`insert into products (name, brand, model, category_id, tracking_type)
    values ('CO2 sensor', 'Milesight', 'AM-SC', ${cat}, 'serialised') returning id::int`;
  [{ id: cable }] = await sql`insert into products (name, brand, model, category_id, tracking_type)
    values ('Cat6 cable', 'Generic', 'CAT6-SC', ${cat}, 'quantity') returning id::int`;
  await receiveDelivery(EDITOR, {
    supplierId, receivedOn: today,
    lines: [
      { productId: router, quantity: 1, serials: ["SC-R1"] },
      { productId: sim, quantity: 1, serials: ["8996800000000000501"] },
      { productId: sensor, quantity: 1, serials: ["SC-S1"] },
      { productId: cable, quantity: 10 },
    ],
  });
  for (const row of await sql`select id::int, serial_number from units where product_id in ${sql([router, sim, sensor])}`) {
    unit[row.serial_number] = row.id;
  }
  await configureRouter(EDITOR, { routerUnitId: unit["SC-R1"], simUnitId: unit["8996800000000000501"] });
  [{ id: officeId }] = await sql`select office_location_id()::int as id`;

  const [{ id: client }] = await sql`insert into clients (name) values ('SC Client') returning id::int`;
  [{ id: site }] = await sql`insert into facilities (name, client_id, country_id)
    values ('SC Site Nizwa', ${client}, (select id from countries where iso_code = 'OM')) returning id::int`;
});

afterAll(async () => {
  await sql.end();
});

describe("facility stages (R12)", () => {
  it("a Viewer cannot change stages", async () => {
    await expect(changeFacilityStage(VIEWER, { facilityId: site, toStage: "bms_scan" })).rejects.toThrow(ForbiddenError);
  });

  it("an Editor moves one step forward", async () => {
    await changeFacilityStage(EDITOR, { facilityId: site, toStage: "bms_scan" });
    expect(await stageOf()).toBe("bms_scan");
  });

  it("skipping steps without a reason is refused, naming the skipped steps", async () => {
    await expect(changeFacilityStage(EDITOR, { facilityId: site, toStage: "contract" }))
      .rejects.toThrow("Skipping poc, poc study needs a reason");
  });

  it("skipping with a reason is allowed, and the reason is kept", async () => {
    await changeFacilityStage(EDITOR, { facilityId: site, toStage: "contract", reason: "Client signed without a POC" });
    const [h] = await sql`select from_stage::text, to_stage::text, note, changed_by from facility_stage_history
                          where facility_id = ${site} order by id desc limit 1`;
    expect(h).toEqual({ from_stage: "bms_scan", to_stage: "contract", note: "Client signed without a POC", changed_by: EDITOR });
  });

  it("an Editor cannot move a facility back, even with a reason", async () => {
    await expect(changeFacilityStage(EDITOR, { facilityId: site, toStage: "poc", reason: "Contract fell through" }))
      .rejects.toThrow(ForbiddenError);
    expect(await stageOf()).toBe("contract");
  });

  it("an Admin moves it back, but only with a reason", async () => {
    await expect(changeFacilityStage(ADMIN, { facilityId: site, toStage: "poc" })).rejects.toThrow(/needs a reason/);
    await changeFacilityStage(ADMIN, { facilityId: site, toStage: "poc", reason: "Contract fell through, POC restarts" });
    expect(await stageOf()).toBe("poc");
  });

  it("closing is allowed from any stage; re-opening is for Admins", async () => {
    await changeFacilityStage(EDITOR, { facilityId: site, toStage: "closed" });
    await expect(changeFacilityStage(EDITOR, { facilityId: site, toStage: "poc", reason: "Client came back" }))
      .rejects.toThrow(ForbiddenError);
    await expect(changeFacilityStage(EDITOR, { facilityId: site, toStage: "closed" })).rejects.toThrow(/already at closed/);
  });
});

describe("corrections (Super Admin only)", () => {
  it("an Editor or Admin cannot correct stock", async () => {
    await expect(correctStock(EDITOR, { productId: cable, locationId: officeId, change: 2, reason: "Recount" }))
      .rejects.toThrow(ForbiddenError);
    await expect(correctStock(ADMIN, { productId: cable, locationId: officeId, change: 2, reason: "Recount" }))
      .rejects.toThrow(ForbiddenError);
  });

  it("a recount adds 2 cables; removing more than exist is refused", async () => {
    await correctStock(SUPER, { productId: cable, locationId: officeId, change: 2, reason: "Recount found 2 more" });
    expect(await officeCables()).toBe(12);
    await expect(correctStock(SUPER, { productId: cable, locationId: officeId, change: -50, reason: "Recount" }))
      .rejects.toThrow(/Not enough stock/);
    expect(await officeCables()).toBe(12);
  });

  it("needs a reason", async () => {
    await expect(correctStock(SUPER, { productId: cable, locationId: officeId, change: 1, reason: "" })).rejects.toThrow(ValidationError);
  });

  it("a router recorded at the wrong site is put back in the office — its SIM too — and can be deployed again", async () => {
    const { deploymentId } = await createDeployment(EDITOR, { facilityId: site, type: "poc" });
    await addDeploymentItem(EDITOR, { deploymentId, unitId: unit["SC-R1"] });
    await completeDeployment(EDITOR, { deploymentId });

    await correctUnit(SUPER, { unitId: unit["SC-R1"], toLocationId: officeId, status: "configured", reason: "Deployed to the wrong site by mistake" });
    expect(await where("SC-R1")).toEqual({ type: "office", status: "configured" });
    expect(await where("8996800000000000501")).toEqual({ type: "office", status: "configured" });

    const again = await createDeployment(EDITOR, { facilityId: site, type: "poc" });
    await addDeploymentItem(EDITOR, { deploymentId: again.deploymentId, unitId: unit["SC-R1"] });
  });

  it("a sensor written off by mistake is brought back, with the reason in its history", async () => {
    await writeOff(EDITOR, { unitId: unit["SC-S1"], reason: "Thought lost" });
    await correctUnit(SUPER, { unitId: unit["SC-S1"], status: "in_office", reason: "Found in the store room" });
    expect(await where("SC-S1")).toEqual({ type: "office", status: "in_office" });
    const history = await sql`select movement_type::text as type, note from stock_movements
                              where unit_id = ${unit["SC-S1"]} order by id`;
    expect(history.map((h) => h.type)).toEqual(["receive", "write_off", "correction"]);
    expect(history[2].note).toBe("Found in the store room");
  });

  it("refuses a correction that changes nothing", async () => {
    await expect(correctUnit(SUPER, { unitId: unit["SC-S1"], status: "in_office", reason: "No change" }))
      .rejects.toThrow(/Nothing to correct/);
  });
});
