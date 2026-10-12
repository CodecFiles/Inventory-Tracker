import "server-only";
import { z } from "zod";
import { requirePermission, withActor } from "../actor";
import { parseInput, ValidationError } from "../errors";

// Catalogue management: the master lists everything else points at.
//
// Each list is described once below (its table, the permission needed, and its fields). The same
// three actions then work for all of them:
//   create…   add a record
//   update…   change some fields (only the ones sent)
//   archive… / restore…   hide it from new work, or bring it back — records are never deleted,
//                          because history (batches, movements, deployments) keeps pointing at them
//
// The database adds the rules that must never be broken (migration 0012): a received product's kind
// is fixed, a facility's country is fixed once stock moved there, and a place holding stock cannot
// be archived.

const id = z.number().int().positive();
const name = z.string().trim().min(1).max(200);
const opt = (max: number) => z.string().trim().max(max).optional();
const email = z.email().max(254).optional();

type Entity = {
  table: string;
  permission: string;
  fields: z.ZodObject;                    // what can be set on create (required ones required)
  columns: Record<string, string>;        // field name -> database column
  onCreate?: z.ZodObject;                 // extra fields only allowed on create
};

const ENTITIES = {
  category: {
    table: "categories", permission: "products.manage",
    fields: z.object({ name }),
    columns: { name: "name" },
  },
  product: {
    table: "products", permission: "products.manage",
    fields: z.object({
      name, brand: name, model: name, categoryId: id,
      minStockLevel: z.number().int().min(0).max(1_000_000).optional(),
      description: opt(2000),
      specifications: z.record(z.string().max(100), z.string().max(500)).optional(),
      // a product's kind; fixed once it has been received (database rule)
      trackingType: z.enum(["serialised", "quantity", "hybrid"]),
      requiresConfiguration: z.boolean().optional(),
      isSim: z.boolean().optional(),
    }),
    columns: {
      name: "name", brand: "brand", model: "model", categoryId: "category_id", minStockLevel: "min_stock_level",
      description: "description", specifications: "specifications", trackingType: "tracking_type",
      requiresConfiguration: "requires_configuration", isSim: "is_sim",
    },
  },
  supplier: {
    table: "suppliers", permission: "suppliers.manage",
    fields: z.object({
      name,
      // used for batch codes, e.g. TEL-2026-001
      codePrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/, "Use 2–5 letters, e.g. TEL"),
      countryId: id.optional(), email, phone: opt(30),
    }),
    columns: { name: "name", codePrefix: "code_prefix", countryId: "country_id", email: "email", phone: "phone" },
  },
  repairCompany: {
    table: "repair_companies", permission: "suppliers.manage",
    fields: z.object({ name, countryId: id.optional(), email, phone: opt(30) }),
    columns: { name: "name", countryId: "country_id", email: "email", phone: "phone" },
  },
  client: {
    table: "clients", permission: "facilities.manage",
    fields: z.object({ name }),
    columns: { name: "name" },
  },
  facility: {
    table: "facilities", permission: "facilities.manage",
    // the stage is not set here: it changes only through changeFacilityStage (R12)
    fields: z.object({
      name, clientId: id, countryId: id, facilityType: opt(100), city: opt(100), address: opt(500),
      partnerId: id.optional(), projectLead: z.uuid().optional(),
    }),
    columns: {
      name: "name", clientId: "client_id", countryId: "country_id", facilityType: "facility_type", city: "city",
      address: "address", partnerId: "partner_id", projectLead: "project_lead",
    },
  },
  partner: {
    table: "partners", permission: "partners.manage",
    fields: z.object({ name, countryId: id }),
    columns: { name: "name", countryId: "country_id" },
  },
} satisfies Record<string, Entity>;

export type CatalogueEntity = keyof typeof ENTITIES;

function toColumns(entity: Entity, data: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) row[entity.columns[key]] = value;
  }
  return row;
}

export async function createRecord(userId: string, kind: CatalogueEntity, rawInput: unknown): Promise<{ id: number }> {
  const entity: Entity = ENTITIES[kind];
  const row = toColumns(entity, parseInput(entity.fields, rawInput));
  return withActor(userId, async (tx) => {
    await requirePermission(tx, userId, entity.permission);
    const [created] = await tx<{ id: number }[]>`
      insert into ${tx(entity.table)} ${tx(row)} returning id::int`;
    return { id: created.id };
  });
}

export async function updateRecord(userId: string, kind: CatalogueEntity, rawInput: unknown): Promise<void> {
  const entity: Entity = ENTITIES[kind];
  const input = parseInput(entity.fields.partial().extend({ id }), rawInput) as Record<string, unknown>;
  const { id: recordId, ...changes } = input;
  const row = toColumns(entity, changes);
  if (Object.keys(row).length === 0) throw new ValidationError("Nothing to change");
  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, entity.permission);
    const result = await tx`update ${tx(entity.table)} set ${tx(row)} where id = ${recordId as number}`;
    if (result.count === 0) throw new ValidationError("That record does not exist");
  });
}

async function setActive(userId: string, kind: CatalogueEntity, rawInput: unknown, active: boolean): Promise<void> {
  const entity: Entity = ENTITIES[kind];
  const { id: recordId } = parseInput(z.object({ id }), rawInput);
  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, entity.permission);
    const result = await tx`update ${tx(entity.table)} set is_active = ${active} where id = ${recordId}`;
    if (result.count === 0) throw new ValidationError("That record does not exist");
  });
}

export const archiveRecord = (userId: string, kind: CatalogueEntity, rawInput: unknown) => setActive(userId, kind, rawInput, false);
export const restoreRecord = (userId: string, kind: CatalogueEntity, rawInput: unknown) => setActive(userId, kind, rawInput, true);

// ---------------------------------------------------------------------------------------------
// Contacts: people at a facility or a partner. At most one primary contact each.
// Unlike catalogue records these may be removed (nothing in the history points at a contact;
// the audit log still keeps a copy).
// ---------------------------------------------------------------------------------------------
const CONTACTS = {
  facility: { table: "facility_contacts", owner: "facility_id", permission: "facilities.manage" },
  partner: { table: "partner_contacts", owner: "partner_id", permission: "partners.manage" },
} as const;

const contactFields = z.object({ name, role: opt(100), email, phone: opt(30), isPrimary: z.boolean().optional() });
const contactRow = (c: Partial<z.infer<typeof contactFields>>) => toColumns(
  { table: "", permission: "", fields: contactFields,
    columns: { name: "name", role: "role", email: "email", phone: "phone", isPrimary: "is_primary" } },
  c,
);

export async function addContact(userId: string, of: keyof typeof CONTACTS, rawInput: unknown): Promise<{ id: number }> {
  const c = CONTACTS[of];
  const input = parseInput(contactFields.extend({ ownerId: id }), rawInput);
  const { ownerId, ...contact } = input;
  return withActor(userId, async (tx) => {
    await requirePermission(tx, userId, c.permission);
    if (contact.isPrimary) await tx`update ${tx(c.table)} set is_primary = false where ${tx(c.owner)} = ${ownerId}`;
    const [row] = await tx<{ id: number }[]>`
      insert into ${tx(c.table)} ${tx({ ...contactRow(contact), [c.owner]: ownerId })} returning id::int`;
    return { id: row.id };
  });
}

export async function updateContact(userId: string, of: keyof typeof CONTACTS, rawInput: unknown): Promise<void> {
  const c = CONTACTS[of];
  const { id: contactId, ...changes } = parseInput(contactFields.partial().extend({ id }), rawInput);
  const row = contactRow(changes);
  if (Object.keys(row).length === 0) throw new ValidationError("Nothing to change");
  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, c.permission);
    if (changes.isPrimary) {
      await tx`update ${tx(c.table)} set is_primary = false
               where ${tx(c.owner)} = (select ${tx(c.owner)} from ${tx(c.table)} where id = ${contactId}) and id <> ${contactId}`;
    }
    const result = await tx`update ${tx(c.table)} set ${tx(row)} where id = ${contactId}`;
    if (result.count === 0) throw new ValidationError("That contact does not exist");
  });
}

export async function removeContact(userId: string, of: keyof typeof CONTACTS, rawInput: unknown): Promise<void> {
  const c = CONTACTS[of];
  const { id: contactId } = parseInput(z.object({ id }), rawInput);
  await withActor(userId, async (tx) => {
    await requirePermission(tx, userId, c.permission);
    const result = await tx`delete from ${tx(c.table)} where id = ${contactId}`;
    if (result.count === 0) throw new ValidationError("That contact does not exist");
  });
}
