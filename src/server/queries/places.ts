import "server-only";
import { z } from "zod";
import { parseInput, ValidationError } from "../errors";
import { likePattern, optionalId, Page, read } from "./read";

// Facilities (list + detail), the dropdown lists every form needs, and the audit log.

export type FacilityRow = {
  id: number; name: string; city: string | null; stage: string; isActive: boolean; client: string; country: string;
  partner: string | null; units: number; lastDeployment: Date | null;
};
export type LookupProduct = {
  id: number; name: string; brand: string; model: string; categoryId: number; tracking: string;
  needsConfiguration: boolean; isSim: boolean;
};
type Named = { id: number; name: string };

export type FacilityInfo = {
  id: number; name: string; city: string | null; address: string | null; facilityType: string | null; stage: string;
  isActive: boolean; clientId: number; client: string; countryId: number; country: string; abroad: boolean;
  partnerId: number | null; partner: string | null; projectLead: string | null; locationId: number;
};
export type Contact = { id: number; name: string; role: string | null; email: string | null; phone: string | null; isPrimary: boolean };
export type StageChange = { from: string | null; to: string; changedAt: Date; by: string | null; note: string | null };
export type InstalledUnit = {
  unitId: number; serial: string; product: string; status: string; simIccid: string | null; ipAddress: string | null;
  building: string | null; position: string | null;
};
export type FacilityDetail = FacilityInfo & {
  contacts: Contact[]; stageHistory: StageChange[];
  installed: { units: InstalledUnit[]; counted: { productId: number; product: string; quantity: number }[] };
  deployments: { id: number; code: string; status: string; type: string; date: Date | null }[];
};

export async function listFacilities(userId: string, rawInput: unknown = {}) {
  const f = parseInput(Page.extend({
    stage: z.enum(["site_inspection", "bms_scan", "poc", "poc_study", "contract", "deployment",
                   "active_operations", "closed"]).optional(),
    countryId: optionalId,
    clientId: optionalId,
    q: z.string().trim().max(100).optional(),
    includeArchived: z.boolean().default(false),
  }), rawInput);
  return read(userId, (tx) => tx<FacilityRow[]>`
    select f.id::int, f.name, f.city, f.stage::text as stage, f.is_active as "isActive",
           cl.name as client, c.name as country, p.name as partner,
           (select count(*)::int from units u join products pr on pr.id = u.product_id
            where u.location_id = l.id and u.status <> 'retired' and not pr.is_sim) as units,
           (select max(d.deployment_date) from deployments d
            where d.facility_id = f.id and d.status = 'completed') as "lastDeployment"
    from facilities f join clients cl on cl.id = f.client_id join countries c on c.id = f.country_id
    join locations l on l.facility_id = f.id left join partners p on p.id = f.partner_id
    where true
      ${f.includeArchived ? tx`` : tx`and f.is_active`}
      ${f.stage ? tx`and f.stage = ${f.stage}` : tx``}
      ${f.countryId ? tx`and f.country_id = ${f.countryId}` : tx``}
      ${f.clientId ? tx`and f.client_id = ${f.clientId}` : tx``}
      ${f.q ? tx`and (f.name ilike ${likePattern(f.q)} or cl.name ilike ${likePattern(f.q)})` : tx``}
    order by f.name limit ${f.limit} offset ${f.offset}`);
}

export async function facilityDetail(userId: string, rawInput: unknown): Promise<FacilityDetail> {
  const { id } = parseInput(z.object({ id: z.number().int().positive() }), rawInput);
  return read(userId, async (tx) => {
    const [f] = await tx<FacilityInfo[]>`
      select f.id::int, f.name, f.city, f.address, f.facility_type as "facilityType", f.stage::text as stage,
             f.is_active as "isActive", cl.id::int as "clientId", cl.name as client, c.id::int as "countryId",
             c.name as country, c.iso_code <> 'OM' as abroad, p.id::int as "partnerId", p.name as partner,
             lead.full_name as "projectLead", l.id::int as "locationId"
      from facilities f join clients cl on cl.id = f.client_id join countries c on c.id = f.country_id
      join locations l on l.facility_id = f.id left join partners p on p.id = f.partner_id
      left join users lead on lead.id = f.project_lead
      where f.id = ${id}`;
    if (!f) throw new ValidationError("That facility does not exist");
    const contacts = await tx<Contact[]>`select id::int, name, role, email, phone, is_primary as "isPrimary"
               from facility_contacts where facility_id = ${id} order by is_primary desc, name`;
    const stageHistory = await tx<StageChange[]>`select h.from_stage::text as "from", h.to_stage::text as "to", h.changed_at as "changedAt",
                      u.full_name as "by", h.note
               from facility_stage_history h left join users u on u.id = h.changed_by
               where h.facility_id = ${id} order by h.changed_at, h.id`;
    // what is installed there now, with each router's SIM and IP
    const units = await tx<InstalledUnit[]>`select u.id::int as "unitId", u.serial_number as serial, p.name as product, u.status::text as status,
                      s.serial_number as "simIccid", host(a.ip_address) as "ipAddress", i.building, i.position
               from units u join products p on p.id = u.product_id
               left join sim_assignments a on a.router_unit_id = u.id and a.ended_at is null
               left join units s on s.id = a.sim_unit_id
               left join deployment_items i on i.unit_id = u.id and i.removed_at is null
               where u.location_id = ${f.locationId} and u.status <> 'retired' and not p.is_sim
               order by p.name, u.serial_number`;
    const counted = await tx<{ productId: number; product: string; quantity: number }[]>`select p.id::int as "productId", p.name as product, s.quantity from stock_levels s join products p on p.id = s.product_id
               where s.location_id = ${f.locationId} and s.quantity > 0 order by p.name`;
    const deployments = await tx<{ id: number; code: string; status: string; type: string; date: Date | null }[]>`select id::int, code, status::text as status, deployment_type::text as type, deployment_date as "date"
               from deployments where facility_id = ${id} order by id desc`;
    return { ...f, contacts, stageHistory, installed: { units, counted }, deployments };
  });
}

// Everything the forms' dropdowns need, in one call (active records only).
export async function lookups(userId: string) {
  return read(userId, async (tx) => ({
    countries: await tx<(Named & { isoCode: string })[]>`select id::int, name, iso_code as "isoCode" from countries order by name`,
    categories: await tx<Named[]>`select id::int, name from categories where is_active order by name`,
    products: await tx<LookupProduct[]>`select id::int, name, brand, model, category_id::int as "categoryId", tracking_type::text as tracking,
                              requires_configuration as "needsConfiguration", is_sim as "isSim"
                       from products where is_active order by name`,
    suppliers: await tx<(Named & { codePrefix: string })[]>`select id::int, name, code_prefix as "codePrefix" from suppliers where is_active order by name`,
    repairCompanies: await tx<Named[]>`select id::int, name from repair_companies where is_active order by name`,
    clients: await tx<Named[]>`select id::int, name from clients where is_active order by name`,
    partners: await tx<(Named & { country: string; locationId: number })[]>`select p.id::int, p.name, c.name as country,
                              (select l.id::int from locations l where l.partner_id = p.id) as "locationId"
                       from partners p join countries c on c.id = p.country_id
                       where p.is_active order by p.name`,
  }));
}

// ---------------------------------------------------------------------------------------------
// Audit log: who changed what, when — needs its own permission (audit.view).
// ---------------------------------------------------------------------------------------------
export type AuditRow = {
  id: number; occurredAt: Date; action: string; entityType: string; entityId: string | null; actor: string | null;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
};

export async function auditLog(userId: string, rawInput: unknown = {}): Promise<AuditRow[]> {
  const f = parseInput(Page.extend({
    entityType: z.string().regex(/^[a-z_]+$/).max(50).optional(),
    entityId: z.string().max(50).optional(),
    actorId: z.uuid().optional(),
  }), rawInput);
  return read(userId, (tx) => tx<AuditRow[]>`
    select a.id::int, a.occurred_at as "occurredAt", a.action, a.entity_type as "entityType", a.entity_id as "entityId",
           u.full_name as actor, a.before, a.after
    from audit_log a left join users u on u.id = a.actor_id
    where true
      ${f.entityType ? tx`and a.entity_type = ${f.entityType}` : tx``}
      ${f.entityId ? tx`and a.entity_id = ${f.entityId}` : tx``}
      ${f.actorId ? tx`and a.actor_id = ${f.actorId}` : tx``}
    order by a.id desc limit ${f.limit} offset ${f.offset}`, "audit.view");
}

// Every place stock can be (for Super Admin corrections).
export async function allLocations(userId: string) {
  return read(userId, (tx) => tx<{ id: number; name: string; type: string }[]>`
    select id::int, name, type::text from locations
    order by case type when 'office' then 0 when 'facility' then 1 when 'partner_stock' then 2 else 3 end, name`);
}
