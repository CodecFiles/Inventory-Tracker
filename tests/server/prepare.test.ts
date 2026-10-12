// Backend tests for device preparation: receiving SIMs with ICCIDs, configuring routers, swapping
// SIMs (spare or retire) and serialising counted items. Runs against the real test database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSql } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { changeRouterSim, configureRouter, listFreeSims, serialiseItems } from "@/server/inventory/prepare";
import { receiveDelivery } from "@/server/inventory/receive";

const sql = getSql();

const EDITOR = "6f1c2a3e-0000-4000-8000-0000000000a1";
const VIEWER = "6f1c2a3e-0000-4000-8000-0000000000a2";

const ICCID = ["8996800000000000101", "8996800000000000102", "8996800000000000103"];
let supplierId: number;
let routerProduct: number;
let simProduct: number;
let sensorProduct: number;
const unit: Record<string, number> = {};
let sensorLine: number;

const today = new Date().toISOString().slice(0, 10);
const status = async (id: number) => (await sql`select status::text from units where id = ${id}`)[0].status as string;

beforeAll(async () => {
  await sql`insert into auth.users (id) values (${EDITOR}), (${VIEWER})`;
  await sql`insert into users (id, email, full_name, role, status) values
    (${EDITOR}, 'prep-editor@moonrock.om', 'Prep Editor', 'editor', 'approved'),
    (${VIEWER}, 'prep-viewer@gmail.com', 'Prep Viewer', 'viewer', 'approved')`;
  [{ id: supplierId }] = await sql`insert into suppliers (name, code_prefix) values ('Prep Supplier', 'PRE') returning id::int`;
  const [{ id: cat }] = await sql`insert into categories (name) values ('Prep test') returning id::int`;
  [{ id: routerProduct }] = await sql`insert into products (name, brand, model, category_id, tracking_type, requires_configuration)
    values ('TRB router', 'Teltonika', 'TRB-PREP', ${cat}, 'serialised', true) returning id::int`;
  [{ id: simProduct }] = await sql`insert into products (name, brand, model, category_id, tracking_type, is_sim)
    values ('Data SIM', 'Omantel', 'SIM-PREP', ${cat}, 'serialised', true) returning id::int`;
  [{ id: sensorProduct }] = await sql`insert into products (name, brand, model, category_id, tracking_type)
    values ('CO2 sensor', 'Milesight', 'AM-PREP', ${cat}, 'hybrid') returning id::int`;
});

afterAll(async () => {
  await sql.end();
});

describe("receiving SIM cards", () => {
  it("rejects a serial that is not an ICCID, and saves nothing", async () => {
    await expect(
      receiveDelivery(EDITOR, {
        supplierId, receivedOn: today,
        lines: [{ productId: simProduct, quantity: 1, serials: ["12345"] }],
      }),
    ).rejects.toThrow(ValidationError);
    const [{ n }] = await sql`select count(*)::int as n from units where product_id = ${simProduct}`;
    expect(n).toBe(0);
  });

  it("saves each SIM's ICCID, phone number and carrier", async () => {
    await receiveDelivery(EDITOR, {
      supplierId, receivedOn: today,
      lines: [
        { productId: routerProduct, quantity: 1, serials: ["PREP-R1"] },
        { productId: simProduct, quantity: 3, serials: ICCID, phoneNumbers: ["96890000001", "", ""], carrier: "Omantel" },
        { productId: sensorProduct, quantity: 5 },
      ],
    });
    for (const row of await sql`select id::int, serial_number from units where serial_number in ${sql(["PREP-R1", ...ICCID])}`) {
      unit[row.serial_number] = row.id;
    }
    [{ id: sensorLine }] = await sql`select id::int from batch_lines where product_id = ${sensorProduct}`;

    const sims = await sql`select iccid, phone_number, carrier from sim_details d join units u on u.id = d.unit_id
                           where u.product_id = ${simProduct} order by iccid`;
    expect(sims).toEqual([
      { iccid: ICCID[0], phone_number: "96890000001", carrier: "Omantel" },
      { iccid: ICCID[1], phone_number: null, carrier: "Omantel" },
      { iccid: ICCID[2], phone_number: null, carrier: "Omantel" },
    ]);
  });
});

describe("configuring a router", () => {
  it("the dropdown lists the free SIMs", async () => {
    const sims = await listFreeSims(EDITOR);
    expect(sims.map((s) => s.iccid)).toEqual(ICCID);
  });

  it("a Viewer cannot configure routers", async () => {
    await expect(configureRouter(VIEWER, { routerUnitId: unit["PREP-R1"], simUnitId: unit[ICCID[0]] }))
      .rejects.toThrow(ForbiddenError);
  });

  it("rejects an invalid IP address", async () => {
    await expect(configureRouter(EDITOR, { routerUnitId: unit["PREP-R1"], simUnitId: unit[ICCID[0]], ipAddress: "10.0.0.999" }))
      .rejects.toThrow(ValidationError);
  });

  it("puts the SIM in the router; both become configured and the SIM leaves the dropdown", async () => {
    await configureRouter(EDITOR, { routerUnitId: unit["PREP-R1"], simUnitId: unit[ICCID[0]], ipAddress: "10.20.0.1" });
    expect(await status(unit["PREP-R1"])).toBe("configured");
    expect(await status(unit[ICCID[0]])).toBe("configured");
    expect((await listFreeSims(EDITOR)).map((s) => s.iccid)).toEqual([ICCID[1], ICCID[2]]);
  });

  it("a router that already has a SIM must use Change SIM", async () => {
    await expect(configureRouter(EDITOR, { routerUnitId: unit["PREP-R1"], simUnitId: unit[ICCID[1]] }))
      .rejects.toThrow(/Change SIM/);
  });
});

describe("changing a router's SIM", () => {
  it("old SIM as a spare: it returns to the dropdown, the history keeps both", async () => {
    await changeRouterSim(EDITOR, { routerUnitId: unit["PREP-R1"], newSimUnitId: unit[ICCID[1]], ipAddress: "10.20.0.2", oldSim: "spare" });
    expect(await status(unit[ICCID[0]])).toBe("in_office");
    expect(await status(unit[ICCID[1]])).toBe("configured");
    expect((await listFreeSims(EDITOR)).map((s) => s.iccid)).toEqual([ICCID[0], ICCID[2]]);
    const history = await sql`select host(ip_address) as ip, ended_at is not null as ended from sim_assignments
                              where router_unit_id = ${unit["PREP-R1"]} order by id`;
    expect(history).toEqual([{ ip: "10.20.0.1", ended: true }, { ip: "10.20.0.2", ended: false }]);
  });

  it("old SIM retired: it is written off and never offered again", async () => {
    await changeRouterSim(EDITOR, { routerUnitId: unit["PREP-R1"], newSimUnitId: unit[ICCID[2]], oldSim: "retire" });
    expect(await status(unit[ICCID[1]])).toBe("retired");
    expect((await listFreeSims(EDITOR)).map((s) => s.iccid)).toEqual([ICCID[0]]);
  });

  it("if the new SIM is not free, nothing changes (all or nothing)", async () => {
    await expect(changeRouterSim(EDITOR, { routerUnitId: unit["PREP-R1"], newSimUnitId: unit[ICCID[1]], oldSim: "spare" }))
      .rejects.toThrow(ValidationError);
    expect(await status(unit[ICCID[2]])).toBe("configured");
    const [{ n }] = await sql`select count(*)::int as n from sim_assignments where router_unit_id = ${unit["PREP-R1"]} and ended_at is null`;
    expect(n).toBe(1);
  });
});

describe("serialising counted items", () => {
  it("gives serials to 3 of 5 sensors; the office count drops to 2", async () => {
    const result = await serialiseItems(EDITOR, { batchLineId: sensorLine, serials: ["AM-1", "AM-2", "AM-3"] });
    expect(result.unitsCreated).toBe(3);
    const [{ quantity }] = await sql`select quantity from stock_levels
                                     where product_id = ${sensorProduct} and location_id = office_location_id()`;
    expect(quantity).toBe(2);
  });

  it("refuses more serials than items left, and saves none of them", async () => {
    await expect(serialiseItems(EDITOR, { batchLineId: sensorLine, serials: ["AM-4", "AM-5", "AM-6"] }))
      .rejects.toThrow(ValidationError);
    const [{ n }] = await sql`select count(*)::int as n from units where product_id = ${sensorProduct}`;
    expect(n).toBe(3);
  });

  it("refuses products that are not counted-then-serialised", async () => {
    const [{ id: routerLine }] = await sql`select id::int from batch_lines where product_id = ${routerProduct}`;
    await expect(serialiseItems(EDITOR, { batchLineId: routerLine, serials: ["X"] })).rejects.toThrow(/hybrid/);
  });
});
