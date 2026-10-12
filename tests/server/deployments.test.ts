// Backend tests for deployments: drafting, the router-must-be-configured rule, all-or-nothing
// completion (the SIM travels with its router), cancelling, permissions and abroad deployments.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSql } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import {
  addDeploymentItem, cancelDeployment, completeDeployment, createDeployment, removeDeploymentItem, scheduleDeployment,
} from "@/server/deployments/deployments";
import { configureRouter } from "@/server/inventory/prepare";
import { receiveDelivery } from "@/server/inventory/receive";

const sql = getSql();

const EDITOR = "6f1c2a3e-0000-4000-8000-0000000000d1";
const VIEWER = "6f1c2a3e-0000-4000-8000-0000000000d2";

let lulu: number;   // facility in Oman
let doha: number;   // facility in Qatar (through a partner)
let cable: number;
const unit: Record<string, number> = {};

const today = new Date().toISOString().slice(0, 10);
const officeStock = async (productId: number) =>
  (await sql`select coalesce(sum(quantity), 0)::int as q from stock_levels
             where product_id = ${productId} and location_id = office_location_id()`)[0].q as number;
const where = async (unitId: number) =>
  (await sql`select l.type::text as type, u.status::text as status from units u join locations l on l.id = u.location_id
             where u.id = ${unitId}`)[0];

beforeAll(async () => {
  await sql`insert into auth.users (id) values (${EDITOR}), (${VIEWER})`;
  await sql`insert into users (id, email, full_name, role, status) values
    (${EDITOR}, 'dep-editor@moonrock.om', 'Dep Editor', 'editor', 'approved'),
    (${VIEWER}, 'dep-viewer@gmail.com', 'Dep Viewer', 'viewer', 'approved')`;

  const [{ id: supplierId }] = await sql`insert into suppliers (name, code_prefix) values ('Dep Supplier', 'DPS') returning id::int`;
  const [{ id: cat }] = await sql`insert into categories (name) values ('Dep test') returning id::int`;
  const [{ id: router }] = await sql`insert into products (name, brand, model, category_id, tracking_type, requires_configuration)
    values ('TRB router', 'Teltonika', 'TRB-DEP', ${cat}, 'serialised', true) returning id::int`;
  const [{ id: sim }] = await sql`insert into products (name, brand, model, category_id, tracking_type, is_sim)
    values ('Data SIM', 'Omantel', 'SIM-DEP', ${cat}, 'serialised', true) returning id::int`;
  [{ id: cable }] = await sql`insert into products (name, brand, model, category_id, tracking_type)
    values ('Cat6 cable', 'Generic', 'CAT6-DEP', ${cat}, 'quantity') returning id::int`;

  await receiveDelivery(EDITOR, {
    supplierId, receivedOn: today,
    lines: [
      { productId: router, quantity: 3, serials: ["DEP-R1", "DEP-R2", "DEP-R3"] },
      { productId: sim, quantity: 1, serials: ["8996800000000000201"] },
      { productId: cable, quantity: 20 },
    ],
  });
  for (const row of await sql`select id::int, serial_number from units where product_id in ${sql([router, sim])}`) {
    unit[row.serial_number] = row.id;
  }
  await configureRouter(EDITOR, { routerUnitId: unit["DEP-R1"], simUnitId: unit["8996800000000000201"], ipAddress: "10.30.0.1" });

  const [{ id: client }] = await sql`insert into clients (name) values ('Dep Client') returning id::int`;
  [{ id: lulu }] = await sql`insert into facilities (name, client_id, country_id)
    values ('Dep Lulu Muscat', ${client}, (select id from countries where iso_code = 'OM')) returning id::int`;
  const [{ id: partner }] = await sql`insert into partners (name, country_id)
    values ('Dep Qatar Partner', (select id from countries where iso_code = 'QA')) returning id::int`;
  [{ id: doha }] = await sql`insert into facilities (name, client_id, country_id, partner_id)
    values ('Dep Doha Mall', ${client}, (select id from countries where iso_code = 'QA'), ${partner}) returning id::int`;

  // 5 cables shipped to the Qatar partner (shipment actions come later; use the database function)
  const [{ id: shipment }] = await sql`insert into shipments (partner_id, created_by) values (${partner}, ${EDITOR}) returning id::int`;
  await sql`insert into shipment_items (shipment_id, product_id, quantity) values (${shipment}, ${cable}, 5)`;
  await sql`select ship_shipment(${shipment}, ${EDITOR})`;
});

afterAll(async () => {
  await sql.end();
});

describe("drafting a deployment", () => {
  let deploymentId: number;

  it("a Viewer cannot create deployments", async () => {
    await expect(createDeployment(VIEWER, { facilityId: lulu, type: "poc" })).rejects.toThrow(ForbiddenError);
  });

  it("an Editor creates a draft with an automatic DEP code", async () => {
    const result = await createDeployment(EDITOR, { facilityId: lulu, type: "poc" });
    expect(result.code).toMatch(/^DEP-\d{4}-\d{3}$/);
    deploymentId = result.deploymentId;
  });

  it("an unconfigured router is refused", async () => {
    await expect(addDeploymentItem(EDITOR, { deploymentId, unitId: unit["DEP-R2"] })).rejects.toThrow(/not configured/);
  });

  it("a SIM cannot be added on its own — it travels inside its router", async () => {
    await expect(addDeploymentItem(EDITOR, { deploymentId, unitId: unit["8996800000000000201"] }))
      .rejects.toThrow(/travels inside its router/);
  });

  it("a configured router and 6 cables are added; nothing moves yet", async () => {
    await addDeploymentItem(EDITOR, { deploymentId, unitId: unit["DEP-R1"], building: "Main", position: "Plant room" });
    await addDeploymentItem(EDITOR, { deploymentId, productId: cable, quantity: 6 });
    expect(await officeStock(cable)).toBe(15);
    expect((await where(unit["DEP-R1"])).type).toBe("office");
  });

  it("the same router cannot be planned on a second deployment", async () => {
    const other = await createDeployment(EDITOR, { facilityId: lulu, type: "contract" });
    await expect(addDeploymentItem(EDITOR, { deploymentId: other.deploymentId, unitId: unit["DEP-R1"] }))
      .rejects.toThrow(ValidationError);
    await cancelDeployment(EDITOR, { deploymentId: other.deploymentId });
  });

  it("can be scheduled", async () => {
    await scheduleDeployment(EDITOR, { deploymentId, deploymentDate: today });
    const [d] = await sql`select status::text from deployments where id = ${deploymentId}`;
    expect(d.status).toBe("scheduled");
  });

  it("refuses a completion date in the future", async () => {
    await expect(completeDeployment(EDITOR, { deploymentId, date: "2999-01-01" })).rejects.toThrow(/future/);
  });

  it("a Viewer cannot complete it", async () => {
    await expect(completeDeployment(VIEWER, { deploymentId })).rejects.toThrow(ForbiddenError);
  });

  it("completing moves the router, its SIM and the cables to the facility", async () => {
    await completeDeployment(EDITOR, { deploymentId });
    expect(await where(unit["DEP-R1"])).toEqual({ type: "facility", status: "deployed" });
    expect(await where(unit["8996800000000000201"])).toEqual({ type: "facility", status: "deployed" });
    expect(await officeStock(cable)).toBe(9);
  });

  it("a completed deployment cannot be changed", async () => {
    await expect(addDeploymentItem(EDITOR, { deploymentId, productId: cable, quantity: 1 })).rejects.toThrow(/completed/);
  });
});

describe("all or nothing", () => {
  it("too many cables: refused with a clear message, and nothing moves", async () => {
    const { deploymentId } = await createDeployment(EDITOR, { facilityId: lulu, type: "poc" });
    await addDeploymentItem(EDITOR, { deploymentId, productId: cable, quantity: 5 });
    await addDeploymentItem(EDITOR, { deploymentId, productId: cable, quantity: 50 });
    await expect(completeDeployment(EDITOR, { deploymentId })).rejects.toThrow(/need 55, have 9/);
    expect(await officeStock(cable)).toBe(9);

    // removing the bad line lets it complete
    const [line] = await sql`select id::int from deployment_items where deployment_id = ${deploymentId} and quantity = 50`;
    await removeDeploymentItem(EDITOR, { itemId: line.id });
    await completeDeployment(EDITOR, { deploymentId });
    expect(await officeStock(cable)).toBe(4);
  });
});

describe("abroad deployments (through the partner)", () => {
  it("routers in MRD Office cannot go straight to an abroad facility", async () => {
    const { deploymentId } = await createDeployment(EDITOR, { facilityId: doha, type: "poc" });
    await expect(addDeploymentItem(EDITOR, { deploymentId, unitId: unit["DEP-R3"] })).rejects.toThrow(/partner's stock/);
  });

  it("cables come from the partner's stock, not the office", async () => {
    const { deploymentId } = await createDeployment(EDITOR, { facilityId: doha, type: "contract" });
    await addDeploymentItem(EDITOR, { deploymentId, productId: cable, quantity: 3 });
    await completeDeployment(EDITOR, { deploymentId });
    expect(await officeStock(cable)).toBe(4);
    const [p] = await sql`select s.quantity from stock_levels s join locations l on l.id = s.location_id
                          where l.type = 'partner_stock' and s.product_id = ${cable}`;
    expect(p.quantity).toBe(2);
  });
});
