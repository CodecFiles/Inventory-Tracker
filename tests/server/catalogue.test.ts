// Backend tests for catalogue management: permissions per list, validation, archive instead of
// delete, the product-kind lock, and primary contacts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSql } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import {
  addContact, archiveRecord, createRecord, removeContact, restoreRecord, updateContact, updateRecord,
} from "@/server/catalogue/catalogue";
import { receiveDelivery } from "@/server/inventory/receive";

const sql = getSql();

const EDITOR = "6f1c2a3e-0000-4000-8000-0000000007a1";
const ADMIN = "6f1c2a3e-0000-4000-8000-0000000007a2";
const SUPER = "6f1c2a3e-0000-4000-8000-0000000007a3";

const today = new Date().toISOString().slice(0, 10);
let categoryId: number;
let productId: number;
let supplierId: number;
let clientId: number;
let facilityId: number;
const country = async (iso: string) => (await sql`select id::int from countries where iso_code = ${iso}`)[0].id as number;

beforeAll(async () => {
  await sql`insert into auth.users (id) values (${EDITOR}), (${ADMIN}), (${SUPER})`;
  await sql`insert into users (id, email, full_name, role, status) values
    (${EDITOR}, 'cat-editor@moonrock.om', 'Cat Editor', 'editor', 'approved'),
    (${ADMIN}, 'cat-admin@moonrock.om', 'Cat Admin', 'admin', 'approved'),
    (${SUPER}, 'cat-super@moonrock.om', 'Cat Super', 'super_admin', 'approved')`;
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${SUPER}, true)`;
    await tx`insert into user_permissions (user_id, permission_key, granted_by) values (${ADMIN}, 'products.manage', ${SUPER})`;
  });
});

afterAll(async () => {
  await sql.end();
});

describe("products and categories", () => {
  it("an Editor cannot manage products; an Admin given the permission can", async () => {
    await expect(createRecord(EDITOR, "category", { name: "Cat routers" })).rejects.toThrow(ForbiddenError);
    ({ id: categoryId } = await createRecord(ADMIN, "category", { name: "Cat routers" }));
    ({ id: productId } = await createRecord(ADMIN, "product", {
      name: "TRB140 router", brand: "Teltonika", model: "TRB140-CAT", categoryId, trackingType: "serialised",
      requiresConfiguration: true, minStockLevel: 5, specifications: { ports: "1x LAN", power: "9–30 V" },
    }));
    const [p] = await sql`select tracking_type::text, requires_configuration, specifications from products where id = ${productId}`;
    expect(p).toEqual({ tracking_type: "serialised", requires_configuration: true, specifications: { ports: "1x LAN", power: "9–30 V" } });
  });

  it("the same brand + model twice is refused", async () => {
    await expect(createRecord(ADMIN, "product", { name: "Copy", brand: "Teltonika", model: "TRB140-CAT", categoryId, trackingType: "serialised" }))
      .rejects.toThrow(/Already exists/);
  });

  it("only the fields sent are changed", async () => {
    await updateRecord(ADMIN, "product", { id: productId, minStockLevel: 8 });
    const [p] = await sql`select name, min_stock_level from products where id = ${productId}`;
    expect(p).toEqual({ name: "TRB140 router", min_stock_level: 8 });
    await expect(updateRecord(ADMIN, "product", { id: productId })).rejects.toThrow(/Nothing to change/);
    await expect(updateRecord(ADMIN, "product", { id: 999999, name: "Ghost" })).rejects.toThrow(/does not exist/);
  });
});

describe("suppliers", () => {
  it("the batch-code prefix is stored in capitals and must be 2–5 letters", async () => {
    await expect(createRecord(SUPER, "supplier", { name: "Bad prefix", codePrefix: "A1" })).rejects.toThrow(/2–5 letters/);
    ({ id: supplierId } = await createRecord(SUPER, "supplier", { name: "Cat Teltonika Dist", codePrefix: "ctd", email: "sales@ctd.example" }));
    const [s] = await sql`select code_prefix from suppliers where id = ${supplierId}`;
    expect(s.code_prefix).toBe("CTD");
  });

  it("an archived supplier cannot be used for receiving; restored, it can", async () => {
    await archiveRecord(SUPER, "supplier", { id: supplierId });
    const delivery = { supplierId, receivedOn: today, lines: [{ productId, quantity: 1, serials: ["CAT-R1"] }] };
    await expect(receiveDelivery(EDITOR, delivery)).rejects.toThrow(/archived/);
    await restoreRecord(SUPER, "supplier", { id: supplierId });
    await receiveDelivery(EDITOR, delivery);
  });

  it("once received, a product's kind is locked; its name is not", async () => {
    await expect(updateRecord(ADMIN, "product", { id: productId, trackingType: "quantity" })).rejects.toThrow(/cannot change/);
    await updateRecord(ADMIN, "product", { id: productId, name: "TRB140 LTE router" });
  });

  it("repair companies are managed with the supplier permission", async () => {
    await expect(createRecord(EDITOR, "repairCompany", { name: "Cat Repairs" })).rejects.toThrow(ForbiddenError);
    await createRecord(SUPER, "repairCompany", { name: "Cat Repairs", countryId: await country("OM") });
  });
});

describe("clients, facilities and partners", () => {
  it("an Editor adds a client and an Oman facility", async () => {
    ({ id: clientId } = await createRecord(EDITOR, "client", { name: "Cat Mall Group" }));
    ({ id: facilityId } = await createRecord(EDITOR, "facility", {
      name: "Cat Mall Muscat", clientId, countryId: await country("OM"), city: "Muscat",
    }));
    const [f] = await sql`select stage::text from facilities where id = ${facilityId}`;
    expect(f.stage).toBe("site_inspection");
  });

  it("the stage cannot be changed through editing (only through a stage change)", async () => {
    await expect(updateRecord(EDITOR, "facility", { id: facilityId, stage: "closed" })).rejects.toThrow(/Nothing to change/);
  });

  it("a facility abroad needs a partner from that country; partners need the partner permission", async () => {
    await expect(createRecord(EDITOR, "facility", { name: "Cat Mall Doha", clientId, countryId: await country("QA") }))
      .rejects.toThrow(/must have a partner/);
    await expect(createRecord(EDITOR, "partner", { name: "Cat Qatar Partner", countryId: await country("QA") }))
      .rejects.toThrow(ForbiddenError);
    const { id: partnerId } = await createRecord(SUPER, "partner", { name: "Cat Qatar Partner", countryId: await country("QA") });
    await createRecord(EDITOR, "facility", { name: "Cat Mall Doha", clientId, countryId: await country("QA"), partnerId });
  });

  it("an empty facility can be archived and restored", async () => {
    await archiveRecord(EDITOR, "facility", { id: facilityId });
    await restoreRecord(EDITOR, "facility", { id: facilityId });
  });
});

describe("contacts", () => {
  it("only one primary contact per facility — a new primary replaces the old one", async () => {
    const { id: first } = await addContact(EDITOR, "facility", { ownerId: facilityId, name: "Aisha", isPrimary: true });
    const { id: second } = await addContact(EDITOR, "facility", { ownerId: facilityId, name: "Rahul", role: "Facility manager" });
    await updateContact(EDITOR, "facility", { id: second, isPrimary: true, phone: "+968 9000 0000" });
    const rows = await sql`select id::int, is_primary from facility_contacts where facility_id = ${facilityId} order by id`;
    expect(rows).toEqual([{ id: first, is_primary: false }, { id: second, is_primary: true }]);
  });

  it("rejects a bad email and can remove a contact", async () => {
    await expect(addContact(EDITOR, "facility", { ownerId: facilityId, name: "X", email: "not-an-email" })).rejects.toThrow(ValidationError);
    const { id } = await addContact(EDITOR, "facility", { ownerId: facilityId, name: "Temp" });
    await removeContact(EDITOR, "facility", { id });
    const [{ n }] = await sql`select count(*)::int as n from facility_contacts where id = ${id}`;
    expect(n).toBe(0);
  });
});
