import "server-only";
import { z } from "zod";
import { parseInput, ValidationError } from "../errors";
import { likePattern, optionalId, Page, read } from "./read";

// ---------------------------------------------------------------------------------------------
// Stock overview (Dashboard / Inventory): how many of each product are where, and which are low.
// Units count one each (retired and returned-to-supplier ones are gone); counted items come from
// the balances. "Low" = fewer in MRD Office than the product's minimum stock level.
// ---------------------------------------------------------------------------------------------
export type StockRow = {
  productId: number; name: string; brand: string; model: string; category: string; tracking: string;
  minStock: number; inOffice: number; atFacilities: number; atPartners: number; inRepair: number; lowStock: boolean;
};

export async function stockOverview(userId: string, rawInput: unknown = {}): Promise<StockRow[]> {
  const { lowOnly } = parseInput(z.object({ lowOnly: z.boolean().default(false) }), rawInput);
  return read(userId, (tx) => tx<StockRow[]>`
    with counts as (
      select u.product_id, l.type, count(*)::int as n
      from units u join locations l on l.id = u.location_id
      where u.status not in ('retired', 'returned_to_supplier')
      group by 1, 2
      union all
      select s.product_id, l.type, sum(s.quantity)::int
      from stock_levels s join locations l on l.id = s.location_id
      group by 1, 2
    ), totals as (
      select p.id::int as "productId", p.name, p.brand, p.model, c.name as category,
             p.tracking_type::text as tracking, p.min_stock_level as "minStock",
             coalesce(sum(k.n) filter (where k.type = 'office'), 0)::int as "inOffice",
             coalesce(sum(k.n) filter (where k.type = 'facility'), 0)::int as "atFacilities",
             coalesce(sum(k.n) filter (where k.type = 'partner_stock'), 0)::int as "atPartners",
             coalesce(sum(k.n) filter (where k.type in ('repair_company', 'supplier')), 0)::int as "inRepair"
      from products p join categories c on c.id = p.category_id
      left join counts k on k.product_id = p.id
      where p.is_active
      group by p.id, c.name
    )
    select *, "inOffice" < "minStock" as "lowStock" from totals
    where ${lowOnly ? tx`"inOffice" < "minStock"` : tx`true`}
    order by category, name`);
}

// ---------------------------------------------------------------------------------------------
// Item list (Inventory, Device preparation, SIM cards). Each row shows where the unit is and its
// SIM link: for a router, the SIM inside and its IP; for a SIM, the router it is in.
// ---------------------------------------------------------------------------------------------
export const ListUnitsInput = Page.extend({
  productId: optionalId,
  status: z.enum(["in_office", "configured", "deployed", "shipped_to_partner", "deployed_abroad",
                  "in_repair", "returned_to_supplier", "retired"]).optional(),
  place: z.enum(["office", "facility", "partner_stock", "repair_company", "supplier"]).optional(),
  locationId: optionalId,
  simsOnly: z.boolean().default(false),
  // Device preparation: routers in the office that have no SIM yet
  unconfiguredRouters: z.boolean().default(false),
  q: z.string().trim().max(100).optional(),
});

export type UnitRow = {
  unitId: number; serial: string; imei: string | null; product: string; productId: number; status: string;
  place: string; location: string; iccid: string | null; phoneNumber: string | null;
  simIccid: string | null; ipAddress: string | null; inRouter: string | null; total: number;
};

export async function listUnits(userId: string, rawInput: unknown = {}): Promise<{ rows: UnitRow[]; total: number }> {
  const f = parseInput(ListUnitsInput, rawInput);
  return read(userId, async (tx) => {
    const rows = await tx<UnitRow[]>`
      select u.id::int as "unitId", u.serial_number as serial, u.imei, p.name as product, p.id::int as "productId",
             u.status::text as status, l.type::text as place, l.name as location,
             d.iccid, d.phone_number as "phoneNumber",
             rs.serial_number as "simIccid", host(ra.ip_address) as "ipAddress",
             sr.serial_number as "inRouter",
             count(*) over ()::int as total
      from units u
      join products p on p.id = u.product_id
      join locations l on l.id = u.location_id
      left join sim_details d on d.unit_id = u.id
      left join sim_assignments ra on ra.router_unit_id = u.id and ra.ended_at is null
      left join units rs on rs.id = ra.sim_unit_id
      left join sim_assignments sa on sa.sim_unit_id = u.id and sa.ended_at is null
      left join units sr on sr.id = sa.router_unit_id
      where true
        ${f.productId ? tx`and u.product_id = ${f.productId}` : tx``}
        ${f.status ? tx`and u.status = ${f.status}` : tx``}
        ${f.place ? tx`and l.type = ${f.place}` : tx``}
        ${f.locationId ? tx`and u.location_id = ${f.locationId}` : tx``}
        ${f.simsOnly ? tx`and p.is_sim` : tx``}
        ${f.unconfiguredRouters
          ? tx`and p.requires_configuration and u.location_id = office_location_id()
               and u.status in ('in_office', 'configured') and ra.id is null`
          : tx``}
        ${f.q ? tx`and (u.serial_number ilike ${likePattern(f.q)} or u.imei ilike ${likePattern(f.q)}
                        or d.phone_number ilike ${likePattern(f.q)})` : tx``}
      order by p.name, u.serial_number
      limit ${f.limit} offset ${f.offset}`;
    return { rows, total: rows[0]?.total ?? 0 };
  });
}

// ---------------------------------------------------------------------------------------------
// One item's full story (Device detail): what it is, where it is, every movement, its SIM history.
// ---------------------------------------------------------------------------------------------
export async function unitDetail(userId: string, rawInput: unknown) {
  const { unitId } = parseInput(z.object({ unitId: z.number().int().positive() }), rawInput);
  return read(userId, async (tx) => {
    const [unit] = await tx`
      select u.id::int as "unitId", u.serial_number as serial, u.imei, u.status::text as status, u.created_at as "createdAt",
             p.id::int as "productId", p.name as product, p.brand, p.model, p.is_sim as "isSim",
             p.requires_configuration as "needsConfiguration",
             l.type::text as place, l.name as location,
             b.code as "batchCode", s.name as supplier, b.received_on as "receivedOn",
             d.iccid, d.phone_number as "phoneNumber", d.carrier
      from units u
      join products p on p.id = u.product_id
      join locations l on l.id = u.location_id
      join batch_lines bl on bl.id = u.batch_line_id
      join batches b on b.id = bl.batch_id
      join suppliers s on s.id = b.supplier_id
      left join sim_details d on d.unit_id = u.id
      where u.id = ${unitId}`;
    if (!unit) throw new ValidationError("That item does not exist");

    const movements = await tx`
      select m.id::int, m.movement_type::text as type, m.moved_at as "movedAt", m.note,
             fl.name as "from", tl.name as "to", us.full_name as "by",
             coalesce(dp.code, sh.code, bt.code) as document
      from stock_movements m
      left join locations fl on fl.id = m.from_location_id
      left join locations tl on tl.id = m.to_location_id
      join users us on us.id = m.performed_by
      left join deployments dp on dp.id = m.deployment_id
      left join shipments sh on sh.id = m.shipment_id
      left join batches bt on bt.id = m.batch_id
      where m.unit_id = ${unitId}
      order by m.moved_at, m.id`;

    // SIM history: for a router, the SIMs it held; for a SIM, the routers it was in
    const simHistory = await tx`
      select case when a.router_unit_id = ${unitId} then s.serial_number else r.serial_number end as "otherSerial",
             host(a.ip_address) as "ipAddress", a.assigned_at as "assignedAt", a.ended_at as "endedAt",
             ab.full_name as "assignedBy", eb.full_name as "endedBy"
      from sim_assignments a
      join units r on r.id = a.router_unit_id
      join units s on s.id = a.sim_unit_id
      join users ab on ab.id = a.assigned_by
      left join users eb on eb.id = a.ended_by
      where ${unitId} in (a.router_unit_id, a.sim_unit_id)
      order by a.assigned_at, a.id`;

    return { ...unit, movements, simHistory };
  });
}

// ---------------------------------------------------------------------------------------------
// Search (top bar): serials, IMEI, ICCID, phone numbers, facilities and document codes.
// ---------------------------------------------------------------------------------------------
export type SearchHit = { kind: "unit" | "facility" | "deployment" | "shipment" | "batch"; id: number; label: string; detail: string };

export async function search(userId: string, rawInput: unknown): Promise<SearchHit[]> {
  const { q } = parseInput(z.object({ q: z.string().trim().min(2, "Type at least 2 characters").max(100) }), rawInput);
  const like = likePattern(q);
  return read(userId, (tx) => tx<SearchHit[]>`
    (select 'unit' as kind, u.id::int, u.serial_number as label, p.name || ' · ' || replace(u.status::text, '_', ' ') as detail
     from units u join products p on p.id = u.product_id left join sim_details d on d.unit_id = u.id
     where u.serial_number ilike ${like} or u.imei ilike ${like} or d.phone_number ilike ${like}
     order by u.serial_number limit 10)
    union all
    (select 'facility', f.id::int, f.name, c.name || ' · ' || replace(f.stage::text, '_', ' ')
     from facilities f join clients c on c.id = f.client_id
     where f.name ilike ${like} or c.name ilike ${like} order by f.name limit 5)
    union all
    (select 'deployment', d.id::int, d.code, f.name || ' · ' || d.status::text
     from deployments d join facilities f on f.id = d.facility_id where d.code ilike ${like} order by d.id desc limit 5)
    union all
    (select 'shipment', s.id::int, s.code, p.name || ' · ' || replace(s.status::text, '_', ' ')
     from shipments s join partners p on p.id = s.partner_id
     where s.code ilike ${like} or s.tracking_number ilike ${like} order by s.id desc limit 5)
    union all
    (select 'batch', b.id::int, b.code, s.name || ' · ' || b.received_on::text
     from batches b join suppliers s on s.id = b.supplier_id
     where b.code ilike ${like} or b.invoice_number ilike ${like} or b.purchase_order ilike ${like}
     order by b.id desc limit 5)`);
}
