// Backend tests for the read queries behind the screens: who may read, stock overview with low
// stock, item lists and history, search, documents, facility detail and the audit log.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSql } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { addDeploymentItem, completeDeployment, createDeployment } from "@/server/deployments/deployments";
import { configureRouter } from "@/server/inventory/prepare";
import { receiveDelivery } from "@/server/inventory/receive";
import { dashboardPanels } from "@/server/queries/dashboard";
import { batchDetail, deploymentDetail, listDeployments } from "@/server/queries/documents";
import { listUnits, search, stockOverview, unitDetail } from "@/server/queries/inventory";
import { auditLog, facilityDetail, listFacilities, lookups } from "@/server/queries/places";

const sql = getSql();

const EDITOR = "6f1c2a3e-0000-4000-8000-0000000009e1";
const VIEWER = "6f1c2a3e-0000-4000-8000-0000000009e2";
const ADMIN = "6f1c2a3e-0000-4000-8000-0000000009e3";  // an Admin with no permissions granted
const SUPER = "6f1c2a3e-0000-4000-8000-0000000009e4";
const DISABLED = "6f1c2a3e-0000-4000-8000-0000000009e5";  // a Viewer whose account was disabled
const SIM = ["8996800000000000901", "8996800000000000902", "8996800000000000903"];

let router: number;
let sim: number;
let cable: number;
let site: number;
let batchId: number;
let batchCode: string;
let deploymentCode: string;
const unit: Record<string, number> = {};
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await sql`insert into auth.users (id) values (${EDITOR}), (${VIEWER}), (${ADMIN}), (${SUPER}), (${DISABLED})`;
  await sql`insert into users (id, email, full_name, role, status) values
    (${EDITOR}, 'q-editor@moonrock.om', 'Query Editor', 'editor', 'approved'),
    (${VIEWER}, 'q-viewer@gmail.com', 'Query Viewer', 'viewer', 'approved'),
    (${ADMIN}, 'q-admin@moonrock.om', 'Query Admin', 'admin', 'approved'),
    (${SUPER}, 'q-super@moonrock.om', 'Query Super', 'super_admin', 'approved'),
    (${DISABLED}, 'q-disabled@gmail.com', 'Query Disabled', 'viewer', 'disabled')`;
  const [{ id: supplierId }] = await sql`insert into suppliers (name, code_prefix) values ('Query Supplier', 'QRS') returning id::int`;
  const [{ id: cat }] = await sql`insert into categories (name) values ('Query test') returning id::int`;
  [{ id: router }] = await sql`insert into products (name, brand, model, category_id, tracking_type, requires_configuration, min_stock_level)
    values ('Q router', 'Teltonika', 'TRB-Q', ${cat}, 'serialised', true, 3) returning id::int`;
  [{ id: sim }] = await sql`insert into products (name, brand, model, category_id, tracking_type, is_sim)
    values ('Q SIM', 'Omantel', 'SIM-Q', ${cat}, 'serialised', true) returning id::int`;
  [{ id: cable }] = await sql`insert into products (name, brand, model, category_id, tracking_type, min_stock_level)
    values ('Q cable', 'Generic', 'CAT6-Q', ${cat}, 'quantity', 5) returning id::int`;

  ({ batchId, code: batchCode } = await receiveDelivery(EDITOR, {
    supplierId, receivedOn: today, invoiceNumber: "INV-Q-77",
    lines: [
      { productId: router, quantity: 3, serials: ["Q-R1", "Q-R2", "Q-R3"] },
      { productId: sim, quantity: 3, serials: SIM, phoneNumbers: ["96891112222", "", ""] },
      { productId: cable, quantity: 4 },
    ],
  }));
  for (const row of await sql`select id::int, serial_number from units where product_id in ${sql([router, sim])}`) {
    unit[row.serial_number] = row.id;
  }
  await configureRouter(EDITOR, { routerUnitId: unit["Q-R1"], simUnitId: unit[SIM[0]], ipAddress: "10.50.0.1" });
  // Q-R3 is configured but stays in the office; Q-R2 has no SIM
  await configureRouter(EDITOR, { routerUnitId: unit["Q-R3"], simUnitId: unit[SIM[2]] });

  const [{ id: client }] = await sql`insert into clients (name) values ('Query Client') returning id::int`;
  [{ id: site }] = await sql`insert into facilities (name, client_id, country_id)
    values ('Query Plaza Salalah', ${client}, (select id from countries where iso_code = 'OM')) returning id::int`;
  const d = await createDeployment(EDITOR, { facilityId: site, type: "poc" });
  deploymentCode = d.code;
  await addDeploymentItem(EDITOR, { deploymentId: d.deploymentId, unitId: unit["Q-R1"], building: "Mall", position: "Roof" });
  await addDeploymentItem(EDITOR, { deploymentId: d.deploymentId, productId: cable, quantity: 1 });
  await completeDeployment(EDITOR, { deploymentId: d.deploymentId });
});

afterAll(async () => {
  await sql.end();
});

describe("who may read", () => {
  it("a Viewer can read; an Admin without 'view reports' cannot", async () => {
    await stockOverview(VIEWER);
    await expect(stockOverview(ADMIN)).rejects.toThrow(ForbiddenError);
  });

  it("a disabled account cannot read, even with a role that may", async () => {
    await expect(stockOverview(DISABLED)).rejects.toThrow("not been approved");
    await expect(stockOverview("6f1c2a3e-0000-4000-8000-0000000009ff")).rejects.toThrow("not been approved");   // no such user
  });

  it("the audit log needs its own permission", async () => {
    await expect(auditLog(VIEWER)).rejects.toThrow(ForbiddenError);
    const rows = await auditLog(SUPER, { entityType: "deployments", limit: 5 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("actor");
  });
});

describe("dashboard panels", () => {
  it("counts a router and the SIM inside it as POC equipment, the rest as office stock", async () => {
    const { categories, life, batches } = await dashboardPanels(VIEWER);
    const q = categories.find((c) => c.category === "Query test")!;
    // Q-R1 and its SIM went out on a POC deployment; 2 routers and 2 SIMs are still in the office
    expect(q).toMatchObject({ total: 6, deployed: 2, poc: 2, contract: 0, inStock: 4, reserved: 0 });
    expect(life.poc).toBeGreaterThanOrEqual(2);
    expect(batches.some((b) => b.code === batchCode && b.quantity === 10 && b.lines === 3)).toBe(true);
    await expect(dashboardPanels(ADMIN)).rejects.toThrow(ForbiddenError);
  });
});

describe("stock overview", () => {
  it("counts each product where it is and flags low stock", async () => {
    const rows = (await stockOverview(VIEWER)).filter((r) => [router, sim, cable].includes(r.productId));
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by["Q router"]).toMatchObject({ inOffice: 2, atFacilities: 1, lowStock: true });   // 2 < min 3
    expect(by["Q SIM"]).toMatchObject({ inOffice: 2, atFacilities: 1, lowStock: false });     // no minimum
    expect(by["Q cable"]).toMatchObject({ inOffice: 3, atFacilities: 1, lowStock: true });    // 3 < min 5
    const low = (await stockOverview(VIEWER, { lowOnly: true })).map((r) => r.productId);
    expect(low).toEqual(expect.arrayContaining([router, cable]));
    expect(low).not.toContain(sim);
  });
});

describe("item lists and history", () => {
  it("Device preparation: routers in the office without a SIM", async () => {
    const { rows } = await listUnits(VIEWER, { productId: router, unconfiguredRouters: true });
    expect(rows.map((r) => r.serial)).toEqual(["Q-R2"]);
  });

  it("each router shows its SIM and IP; each SIM shows its router", async () => {
    const { rows, total } = await listUnits(VIEWER, { productId: router });
    expect(total).toBe(3);
    expect(rows.find((r) => r.serial === "Q-R1")).toMatchObject({ simIccid: SIM[0], ipAddress: "10.50.0.1", place: "facility" });
    const sims = await listUnits(VIEWER, { simsOnly: true, q: "9111" });
    expect(sims.rows).toEqual([expect.objectContaining({ serial: SIM[0], inRouter: "Q-R1", phoneNumber: "96891112222" })]);
  });

  it("an item's full story: received in the batch, deployed with the DEP code, and its SIM", async () => {
    const d = await unitDetail(VIEWER, { unitId: unit["Q-R1"] });
    expect(d).toMatchObject({ serial: "Q-R1", place: "facility", batchCode, supplier: "Query Supplier" });
    expect(d.movements.map((m) => [m.type, m.document])).toEqual([["receive", batchCode], ["deploy", deploymentCode]]);
    expect(d.simHistory).toEqual([expect.objectContaining({ otherSerial: SIM[0], ipAddress: "10.50.0.1", endedAt: null })]);
  });
});

describe("search", () => {
  it("finds serials, facilities and document codes", async () => {
    expect((await search(VIEWER, { q: "Q-R1" })).map((h) => h.kind + ":" + h.label)).toContain("unit:Q-R1");
    expect((await search(VIEWER, { q: "Salalah" }))[0]).toMatchObject({ kind: "facility", label: "Query Plaza Salalah" });
    expect((await search(VIEWER, { q: deploymentCode })).map((h) => h.label)).toContain(deploymentCode);
    expect((await search(VIEWER, { q: "INV-Q-77" })).map((h) => h.label)).toContain(batchCode);
  });

  it("needs 2 characters, and treats % and _ as plain text", async () => {
    await expect(search(VIEWER, { q: "Q" })).rejects.toThrow(ValidationError);
    expect(await search(VIEWER, { q: "%%" })).toEqual([]);
  });
});

describe("documents and places", () => {
  it("deployments list and detail", async () => {
    const list = await listDeployments(VIEWER, { facilityId: site });
    expect(list).toEqual([expect.objectContaining({ code: deploymentCode, status: "completed", items: 2 })]);
    const d = await deploymentDetail(VIEWER, { id: list[0].id });
    expect(d.items.map((i) => i.serial ?? `${i.quantity}× ${i.product}`)).toEqual(["Q-R1", "1× Q cable"]);
  });

  it("batch detail shows each line and its units", async () => {
    const b = await batchDetail(VIEWER, { id: batchId });
    expect(b.lines.map((l) => [l.product, l.quantityReceived, l.serialised])).toEqual([["Q router", 3, 3], ["Q SIM", 3, 3], ["Q cable", 4, 0]]);
    expect(b.units).toHaveLength(6);
  });

  it("facility detail: what is installed (router with SIM and IP, cables) and its stage history", async () => {
    const f = await facilityDetail(VIEWER, { id: site });
    expect(f.installed.units).toEqual([expect.objectContaining({ serial: "Q-R1", simIccid: SIM[0], ipAddress: "10.50.0.1", position: "Roof" })]);
    expect(f.installed.counted).toEqual([expect.objectContaining({ product: "Q cable", quantity: 1 })]);
    expect(f.stageHistory.map((h) => h.to)).toEqual(["site_inspection"]);
    expect((await listFacilities(VIEWER, { q: "Salalah" })).map((x) => x.name)).toEqual(["Query Plaza Salalah"]);
  });

  it("lookups give the dropdown lists", async () => {
    const l = await lookups(VIEWER);
    expect(l.products.map((p) => p.model)).toContain("TRB-Q");
    expect(l.countries.map((c) => c.isoCode)).toContain("OM");
  });
});
