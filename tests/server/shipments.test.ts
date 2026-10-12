// Backend tests for shipments to partners: unconfigured routers and loose SIMs may travel (R10),
// a configured router takes its SIM along, shipping is all or nothing, and abroad deployments then
// take the items from the partner's stock.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSql } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { addDeploymentItem, completeDeployment, createDeployment } from "@/server/deployments/deployments";
import { configureRouter, listFreeSims } from "@/server/inventory/prepare";
import { receiveDelivery } from "@/server/inventory/receive";
import {
  addShipmentItem, cancelShipment, createShipment, markShipmentReceived, removeShipmentItem, shipShipment,
} from "@/server/shipments/shipments";

const sql = getSql();

const EDITOR = "6f1c2a3e-0000-4000-8000-0000000000c1";
const VIEWER = "6f1c2a3e-0000-4000-8000-0000000000c2";
const SIM = ["8996800000000000301", "8996800000000000302", "8996800000000000303"];

let partner: number;
let doha: number;
let cable: number;
let shipmentId: number;
const unit: Record<string, number> = {};

const today = new Date().toISOString().slice(0, 10);
const where = async (serial: string) =>
  (await sql`select l.type::text as type, u.status::text as status from units u join locations l on l.id = u.location_id
             where u.id = ${unit[serial]}`)[0];
const stockAt = async (type: "office" | "partner_stock") =>
  (await sql`select coalesce(sum(s.quantity), 0)::int as q from stock_levels s join locations l on l.id = s.location_id
             where s.product_id = ${cable} and l.type = ${type}`)[0].q as number;

beforeAll(async () => {
  await sql`insert into auth.users (id) values (${EDITOR}), (${VIEWER})`;
  await sql`insert into users (id, email, full_name, role, status) values
    (${EDITOR}, 'shp-editor@moonrock.om', 'Ship Editor', 'editor', 'approved'),
    (${VIEWER}, 'shp-viewer@gmail.com', 'Ship Viewer', 'viewer', 'approved')`;
  const [{ id: supplierId }] = await sql`insert into suppliers (name, code_prefix) values ('Ship Supplier', 'SHS') returning id::int`;
  const [{ id: cat }] = await sql`insert into categories (name) values ('Ship test') returning id::int`;
  const [{ id: router }] = await sql`insert into products (name, brand, model, category_id, tracking_type, requires_configuration)
    values ('TRB router', 'Teltonika', 'TRB-SHP', ${cat}, 'serialised', true) returning id::int`;
  const [{ id: sim }] = await sql`insert into products (name, brand, model, category_id, tracking_type, is_sim)
    values ('Data SIM', 'Ooredoo', 'SIM-SHP', ${cat}, 'serialised', true) returning id::int`;
  [{ id: cable }] = await sql`insert into products (name, brand, model, category_id, tracking_type)
    values ('Cat6 cable', 'Generic', 'CAT6-SHP', ${cat}, 'quantity') returning id::int`;

  await receiveDelivery(EDITOR, {
    supplierId, receivedOn: today,
    lines: [
      { productId: router, quantity: 2, serials: ["SHP-R1", "SHP-R2"] },
      { productId: sim, quantity: 3, serials: SIM },
      { productId: cable, quantity: 10 },
    ],
  });
  for (const row of await sql`select id::int, serial_number from units where product_id in ${sql([router, sim])}`) {
    unit[row.serial_number] = row.id;
  }
  await configureRouter(EDITOR, { routerUnitId: unit["SHP-R1"], simUnitId: unit[SIM[0]] });
  // SIM[2] is written off: it must never travel
  await sql`insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id, performed_by)
            values ('write_off', ${sim}, ${unit[SIM[2]]}, 1, office_location_id(), ${EDITOR})`;

  [{ id: partner }] = await sql`insert into partners (name, country_id)
    values ('Ship Qatar Partner', (select id from countries where iso_code = 'QA')) returning id::int`;
  const [{ id: client }] = await sql`insert into clients (name) values ('Ship Client') returning id::int`;
  [{ id: doha }] = await sql`insert into facilities (name, client_id, country_id, partner_id)
    values ('Ship Doha Tower', ${client}, (select id from countries where iso_code = 'QA'), ${partner}) returning id::int`;
});

afterAll(async () => {
  await sql.end();
});

describe("drafting a shipment", () => {
  it("a Viewer cannot create shipments", async () => {
    await expect(createShipment(VIEWER, { partnerId: partner })).rejects.toThrow(ForbiddenError);
  });

  it("an Editor creates a draft with an automatic SHP code", async () => {
    const result = await createShipment(EDITOR, { partnerId: partner, courier: "DHL" });
    expect(result.code).toMatch(/^SHP-\d{4}-\d{3}$/);
    shipmentId = result.shipmentId;
  });

  it("takes a configured router, an UNconfigured router, a loose SIM and cables", async () => {
    await addShipmentItem(EDITOR, { shipmentId, unitId: unit["SHP-R1"] });
    await addShipmentItem(EDITOR, { shipmentId, unitId: unit["SHP-R2"] });
    await addShipmentItem(EDITOR, { shipmentId, unitId: unit[SIM[1]] });
    await addShipmentItem(EDITOR, { shipmentId, productId: cable, quantity: 4 });
  });

  it("refuses the SIM that is inside router R1 (it travels with the router)", async () => {
    await expect(addShipmentItem(EDITOR, { shipmentId, unitId: unit[SIM[0]] })).rejects.toThrow(/inside router SHP-R1/);
  });

  it("refuses a retired SIM", async () => {
    await expect(addShipmentItem(EDITOR, { shipmentId, unitId: unit[SIM[2]] })).rejects.toThrow(/not available/);
  });

  it("not enough cables: refused with a clear message, nothing moves", async () => {
    const { itemId } = await addShipmentItem(EDITOR, { shipmentId, productId: cable, quantity: 100 });
    await expect(shipShipment(EDITOR, { shipmentId })).rejects.toThrow(/need 104, have 10/);
    expect(await where("SHP-R1")).toEqual({ type: "office", status: "configured" });
    await removeShipmentItem(EDITOR, { itemId });
  });
});

describe("shipping", () => {
  it("everything moves to the partner's stock; R1's SIM goes along", async () => {
    await shipShipment(EDITOR, { shipmentId, trackingNumber: "DHL-123" });
    for (const serial of ["SHP-R1", SIM[0], "SHP-R2", SIM[1]]) {
      expect(await where(serial)).toEqual({ type: "partner_stock", status: "shipped_to_partner" });
    }
    expect(await stockAt("office")).toBe(6);
    expect(await stockAt("partner_stock")).toBe(4);
    const [s] = await sql`select status::text, tracking_number, courier from shipments where id = ${shipmentId}`;
    expect(s).toEqual({ status: "shipped", tracking_number: "DHL-123", courier: "DHL" });
  });

  it("a shipped shipment cannot be changed or cancelled", async () => {
    await expect(addShipmentItem(EDITOR, { shipmentId, productId: cable, quantity: 1 })).rejects.toThrow(/shipped/);
    await expect(cancelShipment(EDITOR, { shipmentId })).rejects.toThrow(/shipped/);
  });

  it("the partner confirms receipt — once", async () => {
    await markShipmentReceived(EDITOR, { shipmentId });
    await expect(markShipmentReceived(EDITOR, { shipmentId })).rejects.toThrow(/received by partner/);
  });

  it("a draft can be cancelled", async () => {
    const other = await createShipment(EDITOR, { partnerId: partner });
    await addShipmentItem(EDITOR, { shipmentId: other.shipmentId, productId: cable, quantity: 1 });
    await cancelShipment(EDITOR, { shipmentId: other.shipmentId });
    const [d] = await sql`select status::text from shipments where id = ${other.shipmentId}`;
    expect(d.status).toBe("cancelled");
  });
});

describe("configuring at the partner and deploying abroad (A8)", () => {
  it("the partner's dropdown shows only the loose SIM shipped to them", async () => {
    expect((await listFreeSims(EDITOR, { partnerId: partner })).map((s) => s.iccid)).toEqual([SIM[1]]);
  });

  it("MRD records the partner putting the loose SIM into the unconfigured router", async () => {
    await configureRouter(EDITOR, { routerUnitId: unit["SHP-R2"], simUnitId: unit[SIM[1]], ipAddress: "10.40.0.2" });
    expect(await listFreeSims(EDITOR, { partnerId: partner })).toEqual([]);
    expect(await where("SHP-R2")).toEqual({ type: "partner_stock", status: "shipped_to_partner" });
  });

  it("the abroad deployment takes the router from the partner's stock, and its SIM goes along", async () => {
    const { deploymentId } = await createDeployment(EDITOR, { facilityId: doha, type: "poc" });
    await addDeploymentItem(EDITOR, { deploymentId, unitId: unit["SHP-R2"] });
    await expect(addDeploymentItem(EDITOR, { deploymentId, unitId: unit[SIM[1]] })).rejects.toThrow(/inside router SHP-R2/);
    await addDeploymentItem(EDITOR, { deploymentId, productId: cable, quantity: 2 });
    await completeDeployment(EDITOR, { deploymentId });
    expect(await where("SHP-R2")).toEqual({ type: "facility", status: "deployed_abroad" });
    expect(await where(SIM[1])).toEqual({ type: "facility", status: "deployed_abroad" });
    expect(await stockAt("partner_stock")).toBe(2);
  });
});
