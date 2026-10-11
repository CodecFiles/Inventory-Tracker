// Backend tests for "receive a delivery", run against a real PostgreSQL database built from the
// migrations (tests/global-setup.ts). They check permissions, validation and all-or-nothing saving.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSql } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { receiveDelivery } from "@/server/inventory/receive";

const sql = getSql();

const EDITOR = "00000000-0000-0000-0000-0000000000e1";
const VIEWER = "00000000-0000-0000-0000-0000000000e2";
const PENDING = "00000000-0000-0000-0000-0000000000e3";

let supplierId: number;
let routerId: number;
let cableId: number;
let sensorId: number;

beforeAll(async () => {
  await sql`insert into auth.users (id) values (${EDITOR}), (${VIEWER}), (${PENDING})`;
  await sql`insert into users (id, email, full_name, role, status) values
    (${EDITOR}, 'editor@moonrock.om', 'Ed Editor', 'editor', 'approved'),
    (${VIEWER}, 'viewer@gmail.com', 'Vi Viewer', 'viewer', 'approved')`;
  await sql`insert into users (id, email, full_name) values (${PENDING}, 'new@gmail.com', 'New Person')`;

  [{ id: supplierId }] = await sql`insert into suppliers (name, code_prefix) values ('Teltonika Distributor', 'TEL') returning id::int`;
  const [{ id: cat }] = await sql`insert into categories (name) values ('General') returning id::int`;
  [{ id: routerId }] = await sql`insert into products (name, brand, model, category_id, tracking_type, requires_configuration)
    values ('TRB router', 'Teltonika', 'TRB140', ${cat}, 'serialised', true) returning id::int`;
  [{ id: cableId }] = await sql`insert into products (name, brand, model, category_id, tracking_type)
    values ('Cat6 cable', 'Generic', 'CAT6-1M', ${cat}, 'quantity') returning id::int`;
  [{ id: sensorId }] = await sql`insert into products (name, brand, model, category_id, tracking_type)
    values ('CO2 sensor', 'Milesight', 'AM103', ${cat}, 'hybrid') returning id::int`;
});

afterAll(async () => {
  await sql.end();
});

const today = new Date().toISOString().slice(0, 10);
const batchCount = async () => (await sql`select count(*)::int as n from batches`)[0].n as number;

describe("receiveDelivery", () => {
  it("an Editor receives routers, cables and sensors in one delivery", async () => {
    const result = await receiveDelivery(EDITOR, {
      supplierId,
      receivedOn: today,
      invoiceNumber: "INV-778",
      lines: [
        { productId: routerId, quantity: 2, serials: ["1107442106", "1108675311"] },
        { productId: cableId, quantity: 50 },
        { productId: sensorId, quantity: 10 },
      ],
    });

    expect(result.code).toMatch(/^TEL-\d{4}-001$/);
    expect(result.unitsCreated).toBe(2);

    const units = await sql`select serial_number, status::text, location_id = office_location_id() as in_office
                            from units order by serial_number`;
    expect(units).toEqual([
      { serial_number: "1107442106", status: "in_office", in_office: true },
      { serial_number: "1108675311", status: "in_office", in_office: true },
    ]);

    const stock = await sql`select product_id::int, quantity from stock_levels
                            where location_id = office_location_id() order by product_id`;
    expect(stock).toEqual([
      { product_id: cableId, quantity: 50 },
      { product_id: sensorId, quantity: 10 },
    ]);
  });

  it("records who received it in the audit log", async () => {
    const [row] = await sql`select actor_id from audit_log where action = 'batches.insert' order by id desc limit 1`;
    expect(row.actor_id).toBe(EDITOR);
  });

  it("a Viewer is refused and nothing is saved", async () => {
    const before = await batchCount();
    await expect(
      receiveDelivery(VIEWER, { supplierId, receivedOn: today, lines: [{ productId: cableId, quantity: 5 }] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await batchCount()).toBe(before);
  });

  it("a user who is not yet approved is refused", async () => {
    await expect(
      receiveDelivery(PENDING, { supplierId, receivedOn: today, lines: [{ productId: cableId, quantity: 5 }] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects bad input before touching the database", async () => {
    await expect(
      receiveDelivery(EDITOR, { supplierId, receivedOn: today, lines: [{ productId: cableId, quantity: 0 }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(receiveDelivery(EDITOR, { supplierId, receivedOn: "yesterday", lines: [] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("needs one serial number per router", async () => {
    await expect(
      receiveDelivery(EDITOR, {
        supplierId,
        receivedOn: today,
        lines: [{ productId: routerId, quantity: 3, serials: ["A1", "A2"] }],
      }),
    ).rejects.toThrow(/3 received but 2 serial numbers/);
  });

  it("does not accept serial numbers for counted products", async () => {
    await expect(
      receiveDelivery(EDITOR, {
        supplierId,
        receivedOn: today,
        lines: [{ productId: cableId, quantity: 1, serials: ["X"] }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("a router serial that already exists fails the whole delivery — the cables are not saved either", async () => {
    const before = await batchCount();
    const [{ q: cablesBefore }] = await sql`select quantity as q from stock_levels
                                             where product_id = ${cableId} and location_id = office_location_id()`;

    await expect(
      receiveDelivery(EDITOR, {
        supplierId,
        receivedOn: today,
        lines: [
          { productId: cableId, quantity: 20 },
          { productId: routerId, quantity: 1, serials: ["1107442106"] }, // already received above
        ],
      }),
    ).rejects.toThrow(/Already exists/);

    expect(await batchCount()).toBe(before);
    const [{ q: cablesAfter }] = await sql`select quantity as q from stock_levels
                                            where product_id = ${cableId} and location_id = office_location_id()`;
    expect(cablesAfter).toBe(cablesBefore);
  });
});
