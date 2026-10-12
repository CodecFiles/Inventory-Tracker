// Backend tests for returns, repairs, supplier returns and write-offs, including what happens to a
// router's SIM in each case (R8).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSql } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { addDeploymentItem, completeDeployment, createDeployment } from "@/server/deployments/deployments";
import {
  backFromRepair, returnFromFacility, returnToSupplier, sendForRepair, writeOff,
} from "@/server/inventory/movements";
import { configureRouter, listFreeSims } from "@/server/inventory/prepare";
import { receiveDelivery } from "@/server/inventory/receive";

const sql = getSql();

const EDITOR = "6f1c2a3e-0000-4000-8000-0000000000b1";
const VIEWER = "6f1c2a3e-0000-4000-8000-0000000000b2";
const SIM = ["8996800000000000401", "8996800000000000402", "8996800000000000403"];

let supplierId: number;
let repairCompanyId: number;
let site: number;
let cable: number;
const unit: Record<string, number> = {};

const today = new Date().toISOString().slice(0, 10);
const where = async (serial: string) =>
  (await sql`select l.type::text as type, u.status::text as status from units u join locations l on l.id = u.location_id
             where u.id = ${unit[serial]}`)[0];
const cablesAt = async (type: "office" | "facility") =>
  (await sql`select coalesce(sum(s.quantity), 0)::int as q from stock_levels s join locations l on l.id = s.location_id
             where s.product_id = ${cable} and l.type = ${type}`)[0].q as number;

async function deploy(items: object[]) {
  const { deploymentId } = await createDeployment(EDITOR, { facilityId: site, type: "contract" });
  for (const item of items) await addDeploymentItem(EDITOR, { deploymentId, ...item });
  await completeDeployment(EDITOR, { deploymentId });
}

beforeAll(async () => {
  await sql`insert into auth.users (id) values (${EDITOR}), (${VIEWER})`;
  await sql`insert into users (id, email, full_name, role, status) values
    (${EDITOR}, 'mv-editor@moonrock.om', 'Move Editor', 'editor', 'approved'),
    (${VIEWER}, 'mv-viewer@gmail.com', 'Move Viewer', 'viewer', 'approved')`;
  [{ id: supplierId }] = await sql`insert into suppliers (name, code_prefix) values ('Move Supplier', 'MVS') returning id::int`;
  [{ id: repairCompanyId }] = await sql`insert into repair_companies (name) values ('Muscat Repairs') returning id::int`;
  const [{ id: cat }] = await sql`insert into categories (name) values ('Move test') returning id::int`;
  const [{ id: router }] = await sql`insert into products (name, brand, model, category_id, tracking_type, requires_configuration)
    values ('TRB router', 'Teltonika', 'TRB-MV', ${cat}, 'serialised', true) returning id::int`;
  const [{ id: sim }] = await sql`insert into products (name, brand, model, category_id, tracking_type, is_sim)
    values ('Data SIM', 'Omantel', 'SIM-MV', ${cat}, 'serialised', true) returning id::int`;
  [{ id: cable }] = await sql`insert into products (name, brand, model, category_id, tracking_type)
    values ('Cat6 cable', 'Generic', 'CAT6-MV', ${cat}, 'quantity') returning id::int`;

  await receiveDelivery(EDITOR, {
    supplierId, receivedOn: today,
    lines: [
      { productId: router, quantity: 3, serials: ["MV-R1", "MV-R2", "MV-R3"] },
      { productId: sim, quantity: 3, serials: SIM },
      { productId: cable, quantity: 20 },
    ],
  });
  for (const row of await sql`select id::int, serial_number from units where product_id in ${sql([router, sim])}`) {
    unit[row.serial_number] = row.id;
  }
  for (const [i, r] of ["MV-R1", "MV-R2", "MV-R3"].entries()) {
    await configureRouter(EDITOR, { routerUnitId: unit[r], simUnitId: unit[SIM[i]] });
  }

  const [{ id: client }] = await sql`insert into clients (name) values ('Move Client') returning id::int`;
  [{ id: site }] = await sql`insert into facilities (name, client_id, country_id)
    values ('Move Site Sohar', ${client}, (select id from countries where iso_code = 'OM')) returning id::int`;
  await deploy([{ unitId: unit["MV-R1"] }, { unitId: unit["MV-R3"] }, { productId: cable, quantity: 6 }]);
});

afterAll(async () => {
  await sql.end();
});

describe("returns from a site in Oman", () => {
  it("a Viewer cannot record returns", async () => {
    await expect(returnFromFacility(VIEWER, { facilityId: site, items: [{ unitId: unit["MV-R1"] }] }))
      .rejects.toThrow(ForbiddenError);
  });

  it("more cables than are at the site: refused, nothing moves", async () => {
    await expect(returnFromFacility(EDITOR, { facilityId: site, items: [{ unitId: unit["MV-R1"] }, { productId: cable, quantity: 10 }] }))
      .rejects.toThrow(/need 10, have 6/);
    expect(await where("MV-R1")).toEqual({ type: "facility", status: "deployed" });
  });

  it("router R1 comes back with its SIM, ready to deploy again; 2 cables come back", async () => {
    await returnFromFacility(EDITOR, { facilityId: site, items: [{ unitId: unit["MV-R1"] }, { productId: cable, quantity: 2 }], note: "POC not converted" });
    expect(await where("MV-R1")).toEqual({ type: "office", status: "configured" });
    expect(await where(SIM[0])).toEqual({ type: "office", status: "configured" });
    expect(await cablesAt("office")).toBe(16);
    expect(await cablesAt("facility")).toBe(4);
  });

  it("the returned router can be deployed again", async () => {
    await deploy([{ unitId: unit["MV-R1"] }]);
    expect(await where("MV-R1")).toEqual({ type: "facility", status: "deployed" });
    await returnFromFacility(EDITOR, { facilityId: site, items: [{ unitId: unit["MV-R1"] }] });
  });
});

describe("repairs", () => {
  it("a router with a SIM: the person must say what happens to the SIM", async () => {
    await expect(sendForRepair(EDITOR, { unitId: unit["MV-R2"], repairCompanyId }))
      .rejects.toThrow(/has SIM 8996800000000000402 inside/);
  });

  it("sent for repair from the office, SIM kept as a spare", async () => {
    await sendForRepair(EDITOR, { unitId: unit["MV-R2"], repairCompanyId, sim: "spare", note: "No power" });
    expect(await where("MV-R2")).toEqual({ type: "repair_company", status: "in_repair" });
    expect(await where(SIM[1])).toEqual({ type: "office", status: "in_office" });
    expect((await listFreeSims(EDITOR)).map((s) => s.iccid)).toContain(SIM[1]);
  });

  it("sent for repair straight from a site: its spare SIM is brought back to the office", async () => {
    await sendForRepair(EDITOR, { unitId: unit["MV-R3"], supplierId, sim: "spare" });
    expect(await where("MV-R3")).toEqual({ type: "supplier", status: "in_repair" });
    expect(await where(SIM[2])).toEqual({ type: "office", status: "in_office" });
  });

  it("back from repair to the office — only once", async () => {
    await backFromRepair(EDITOR, { unitId: unit["MV-R2"] });
    expect(await where("MV-R2")).toEqual({ type: "office", status: "in_office" });
    await expect(backFromRepair(EDITOR, { unitId: unit["MV-R2"] })).rejects.toThrow(/not in repair/);
  });

  it("must name exactly one place to repair it", async () => {
    await expect(sendForRepair(EDITOR, { unitId: unit["MV-R2"], repairCompanyId, supplierId })).rejects.toThrow(ValidationError);
  });
});

describe("back to the supplier", () => {
  it("a router at a site must come back to the office first", async () => {
    await deploy([{ unitId: unit["MV-R1"] }]);
    await expect(returnToSupplier(EDITOR, { unitId: unit["MV-R1"], supplierId, sim: "spare" })).rejects.toThrow(/MRD Office first/);
    await returnFromFacility(EDITOR, { facilityId: site, items: [{ unitId: unit["MV-R1"] }] });
  });

  it("from the repair company straight to the supplier (warranty)", async () => {
    const r = unit["MV-R2"];
    await sendForRepair(EDITOR, { unitId: r, repairCompanyId });
    await returnToSupplier(EDITOR, { unitId: r, supplierId, note: "Warranty replacement" });
    expect(await where("MV-R2")).toEqual({ type: "supplier", status: "returned_to_supplier" });
  });
});

describe("write-offs", () => {
  it("a SIM inside a router cannot be written off on its own", async () => {
    await expect(writeOff(EDITOR, { unitId: unit[SIM[0]], reason: "Lost" })).rejects.toThrow(/inside router MV-R1/);
  });

  it("needs a reason", async () => {
    await expect(writeOff(EDITOR, { unitId: unit["MV-R1"], sim: "retire", reason: "" })).rejects.toThrow(/reason/);
  });

  it("router and its SIM retired together; never usable again", async () => {
    await writeOff(EDITOR, { unitId: unit["MV-R1"], sim: "retire", reason: "Water damage" });
    expect(await where("MV-R1")).toMatchObject({ status: "retired" });
    expect(await where(SIM[0])).toMatchObject({ status: "retired" });
    await expect(writeOff(EDITOR, { unitId: unit["MV-R1"], reason: "Again" })).rejects.toThrow(/retired/);
    await expect(createDeployment(EDITOR, { facilityId: site, type: "poc" })
      .then(({ deploymentId }) => addDeploymentItem(EDITOR, { deploymentId, unitId: unit["MV-R1"] })))
      .rejects.toThrow(ValidationError);
  });

  it("counted items: 3 damaged cables in the office, 1 lost at the site", async () => {
    await writeOff(EDITOR, { productId: cable, quantity: 3, reason: "Cut during install" });
    await writeOff(EDITOR, { productId: cable, quantity: 1, facilityId: site, reason: "Lost on site" });
    expect(await cablesAt("office")).toBe(13);
    expect(await cablesAt("facility")).toBe(3);
  });
});
