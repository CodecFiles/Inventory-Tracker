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
  productId: number; name: string; brand: string; model: string; categoryId: number; category: string; tracking: string;
  minStock: number; inOffice: number; atFacilities: number; atPartners: number; inRepair: number; lowStock: boolean;
  // counted pieces only (no serial numbers yet), for listing next to the serialised units
  piecesInOffice: number; piecesElsewhere: number;
};

export async function stockOverview(userId: string, rawInput: unknown = {}): Promise<StockRow[]> {
  const { lowOnly } = parseInput(z.object({ lowOnly: z.boolean().default(false) }), rawInput);
  return read(userId, (tx) => tx<StockRow[]>`
    with counts as (
      select u.product_id, l.type, count(*)::int as n, false as piece
      from units u join locations l on l.id = u.location_id
      where u.status not in ('retired', 'returned_to_supplier')
      group by 1, 2
      union all
      select s.product_id, l.type, sum(s.quantity)::int, true
      from stock_levels s join locations l on l.id = s.location_id
      group by 1, 2
    ), totals as (
      select p.id::int as "productId", p.name, p.brand, p.model, c.id::int as "categoryId", c.name as category,
             p.tracking_type::text as tracking, p.min_stock_level as "minStock",
             coalesce(sum(k.n) filter (where k.type = 'office'), 0)::int as "inOffice",
             coalesce(sum(k.n) filter (where k.type = 'facility'), 0)::int as "atFacilities",
             coalesce(sum(k.n) filter (where k.type = 'partner_stock'), 0)::int as "atPartners",
             coalesce(sum(k.n) filter (where k.type in ('repair_company', 'supplier')), 0)::int as "inRepair",
             coalesce(sum(k.n) filter (where k.piece and k.type = 'office'), 0)::int as "piecesInOffice",
             coalesce(sum(k.n) filter (where k.piece and k.type <> 'office'), 0)::int as "piecesElsewhere"
      from products p join categories c on c.id = p.category_id
      left join counts k on k.product_id = p.id
      where p.is_active
      group by p.id, c.id, c.name
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
  categoryId: optionalId,
  batchId: optionalId,
  sort: z.enum(["product", "newest", "oldest"]).default("product"),
  status: z.enum(["in_office", "configured", "deployed", "shipped_to_partner", "deployed_abroad",
                  "in_repair", "returned_to_supplier", "retired"]).optional(),
  place: z.enum(["office", "facility", "partner_stock", "repair_company", "supplier"]).optional(),
  locationId: optionalId,
  simsOnly: z.boolean().default(false),
  // Device preparation: routers in the office that have no SIM yet
  unconfiguredRouters: z.boolean().default(false),
  // routers (products that need configuration) with or without a SIM, wherever locationId says
  routerSim: z.enum(["with", "without"]).optional(),
  q: z.string().trim().max(100).optional(),
});

export type UnitRow = {
  unitId: number; serial: string; imei: string | null; product: string; productId: number; status: string;
  place: string; location: string; iccid: string | null; phoneNumber: string | null;
  simIccid: string | null; ipAddress: string | null; inRouter: string | null; batchCode: string; batchId: number;
  brand: string; model: string; category: string; tracking: string; receivedOn: Date;
  total: number;
};

export async function listUnits(userId: string, rawInput: unknown = {}): Promise<{ rows: UnitRow[]; total: number }> {
  const f = parseInput(ListUnitsInput, rawInput);
  return read(userId, async (tx) => {
    const rows = await tx<UnitRow[]>`
      select u.id::int as "unitId", u.serial_number as serial, u.imei, p.name as product, p.id::int as "productId",
             u.status::text as status, l.type::text as place, l.name as location,
             d.iccid, d.phone_number as "phoneNumber",
             rs.serial_number as "simIccid", host(ra.ip_address) as "ipAddress",
             sr.serial_number as "inRouter", b.code as "batchCode", b.id::int as "batchId",
             p.brand, p.model, c.name as category, p.tracking_type::text as tracking, b.received_on as "receivedOn",
             count(*) over ()::int as total
      from units u
      join products p on p.id = u.product_id
      join categories c on c.id = p.category_id
      join locations l on l.id = u.location_id
      join batch_lines bl on bl.id = u.batch_line_id
      join batches b on b.id = bl.batch_id
      left join sim_details d on d.unit_id = u.id
      left join sim_assignments ra on ra.router_unit_id = u.id and ra.ended_at is null
      left join units rs on rs.id = ra.sim_unit_id
      left join sim_assignments sa on sa.sim_unit_id = u.id and sa.ended_at is null
      left join units sr on sr.id = sa.router_unit_id
      where true
        ${f.productId ? tx`and u.product_id = ${f.productId}` : tx``}
        ${f.categoryId ? tx`and p.category_id = ${f.categoryId}` : tx``}
        ${f.batchId ? tx`and b.id = ${f.batchId}` : tx``}
        ${f.status ? tx`and u.status = ${f.status}` : tx``}
        ${f.place ? tx`and l.type = ${f.place}` : tx``}
        ${f.locationId ? tx`and u.location_id = ${f.locationId}` : tx``}
        ${f.simsOnly ? tx`and p.is_sim` : tx``}
        ${f.unconfiguredRouters
          ? tx`and p.requires_configuration and u.location_id = office_location_id()
               and u.status in ('in_office', 'configured') and ra.id is null`
          : tx``}
        ${f.routerSim ? tx`and p.requires_configuration and u.status not in ('retired', 'returned_to_supplier')
                             and ra.id is ${f.routerSim === "with" ? tx`not null` : tx`null`}` : tx``}
        ${f.q ? tx`and (u.serial_number ilike ${likePattern(f.q)} or u.imei ilike ${likePattern(f.q)}
                        or d.phone_number ilike ${likePattern(f.q)} or p.name ilike ${likePattern(f.q)}
                        or b.code ilike ${likePattern(f.q)} or l.name ilike ${likePattern(f.q)})` : tx``}
      order by ${f.sort === "newest" ? tx`b.received_on desc, u.id desc`
               : f.sort === "oldest" ? tx`b.received_on, u.id` : tx`p.name, u.serial_number`}
      limit ${f.limit} offset ${f.offset}`;
    return { rows, total: rows[0]?.total ?? 0 };
  });
}

// ---------------------------------------------------------------------------------------------
// One item's full story (Device detail): what it is, where it is, every movement, its SIM history.
// ---------------------------------------------------------------------------------------------
export type UnitInfo = {
  unitId: number; serial: string; imei: string | null; status: string; createdAt: Date;
  productId: number; product: string; brand: string; model: string; isSim: boolean; needsConfiguration: boolean;
  place: string; location: string; batchCode: string; supplier: string; receivedOn: Date;
  iccid: string | null; phoneNumber: string | null; carrier: string | null; facilityId: number | null;
};
// The deployment that brought it to where it is now (for a SIM inside a router: the router's)
export type CurrentDeployment = {
  id: number; code: string; type: string; date: Date | null; facilityId: number; facility: string; stage: string;
  building: string | null; position: string | null;
};
// An open document (draft/scheduled deployment, draft shipment) it is already on
export type Reservation = { kind: "deployment" | "shipment"; id: number; code: string; status: string; to: string };
export type Movement = {
  id: number; type: string; movedAt: Date; note: string | null; from: string | null; to: string | null;
  by: string; document: string | null;
};
export type SimLink = {
  otherUnitId: number; otherSerial: string; ipAddress: string | null; assignedAt: Date; endedAt: Date | null;
  assignedBy: string; endedBy: string | null;
};

export type UnitDetail = UnitInfo & {
  movements: Movement[]; simHistory: SimLink[]; deployment: CurrentDeployment | null; reservation: Reservation | null;
};

export async function unitDetail(userId: string, rawInput: unknown): Promise<UnitDetail> {
  const { unitId } = parseInput(z.object({ unitId: z.number().int().positive() }), rawInput);
  return read(userId, async (tx) => {
    // the four look-ups do not depend on each other, so they go to the database together
    const [[unit], movements, simHistory, [deployment], [reservation]] = await Promise.all([tx<UnitInfo[]>`
      select u.id::int as "unitId", u.serial_number as serial, u.imei, u.status::text as status, u.created_at as "createdAt",
             p.id::int as "productId", p.name as product, p.brand, p.model, p.is_sim as "isSim",
             p.requires_configuration as "needsConfiguration",
             l.type::text as place, l.name as location,
             b.code as "batchCode", s.name as supplier, b.received_on as "receivedOn",
             d.iccid, d.phone_number as "phoneNumber", d.carrier, l.facility_id::int as "facilityId"
      from units u
      join products p on p.id = u.product_id
      join locations l on l.id = u.location_id
      join batch_lines bl on bl.id = u.batch_line_id
      join batches b on b.id = bl.batch_id
      join suppliers s on s.id = b.supplier_id
      left join sim_details d on d.unit_id = u.id
      where u.id = ${unitId}`,
    tx<Movement[]>`
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
      order by m.moved_at, m.id`,
    // SIM history: for a router, the SIMs it held; for a SIM, the routers it was in
    tx<SimLink[]>`
      select case when a.router_unit_id = ${unitId} then s.id else r.id end::int as "otherUnitId",
             case when a.router_unit_id = ${unitId} then s.serial_number else r.serial_number end as "otherSerial",
             host(a.ip_address) as "ipAddress", a.assigned_at as "assignedAt", a.ended_at as "endedAt",
             ab.full_name as "assignedBy", eb.full_name as "endedBy"
      from sim_assignments a
      join units r on r.id = a.router_unit_id
      join units s on s.id = a.sim_unit_id
      join users ab on ab.id = a.assigned_by
      left join users eb on eb.id = a.ended_by
      where ${unitId} in (a.router_unit_id, a.sim_unit_id)
      order by a.assigned_at, a.id`,
    tx<CurrentDeployment[]>`
      select d.id::int, d.code, d.deployment_type::text as type, d.deployment_date as date,
             f.id::int as "facilityId", f.name as facility, f.stage::text as stage, i.building, i.position
      from stock_movements m
      join deployments d on d.id = m.deployment_id
      join facilities f on f.id = d.facility_id
      left join deployment_items i on i.deployment_id = d.id and i.removed_at is null
           and i.unit_id = coalesce((select a.router_unit_id from sim_assignments a
                                     where a.sim_unit_id = m.unit_id and a.ended_at is null), m.unit_id)
      where m.unit_id = ${unitId} and m.movement_type in ('deploy', 'deploy_abroad')
      order by m.moved_at desc, m.id desc limit 1`,
    tx<Reservation[]>`
      select 'deployment' as kind, d.id::int, d.code, d.status::text as status, f.name as "to"
      from deployment_items i join deployments d on d.id = i.deployment_id join facilities f on f.id = d.facility_id
      where i.unit_id = ${unitId} and i.removed_at is null and d.status in ('draft', 'scheduled')
      union all
      select 'shipment', s.id::int, s.code, s.status::text, p.name
      from shipment_items i join shipments s on s.id = i.shipment_id join partners p on p.id = s.partner_id
      where i.unit_id = ${unitId} and i.removed_at is null and s.status = 'draft'
      limit 1`,
    ]);
    if (!unit) throw new ValidationError("That item does not exist");
    return { ...unit, movements, simHistory, deployment: deployment ?? null, reservation: reservation ?? null };
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

// ---------------------------------------------------------------------------------------------
// How many units have each status (Inventory screen's status chips), optionally for one product.
// ---------------------------------------------------------------------------------------------
export async function unitStatusCounts(userId: string, rawInput: unknown = {}): Promise<Record<string, number>> {
  const { productId, categoryId } = parseInput(z.object({ productId: optionalId, categoryId: optionalId }), rawInput);
  return read(userId, async (tx) => {
    const rows = await tx<{ status: string; n: number }[]>`
      select u.status::text, count(*)::int as n from units u join products p on p.id = u.product_id
      where true ${productId ? tx`and u.product_id = ${productId}` : tx``}
        ${categoryId ? tx`and p.category_id = ${categoryId}` : tx``}
      group by 1`;
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  });
}

// Category tabs on All inventory: serialised units plus counted pieces in each category.
export async function categoryCounts(userId: string) {
  return read(userId, (tx) => tx<{ id: number; name: string; units: number; pieces: number }[]>`
    select c.id::int, c.name,
           (select count(*)::int from units u join products p on p.id = u.product_id
            where p.category_id = c.id and u.status not in ('retired', 'returned_to_supplier')) as units,
           (select coalesce(sum(s.quantity), 0)::int from stock_levels s join products p on p.id = s.product_id
            where p.category_id = c.id) as pieces
    from categories c order by c.name`);
}

// ---------------------------------------------------------------------------------------------
// Dashboard totals: where the units are, facilities per stage, and people waiting for approval.
// ---------------------------------------------------------------------------------------------
export async function dashboardSummary(userId: string) {
  return read(userId, async (tx) => {
    const [where] = await tx<{ office: number; facilities: number; partners: number; repair: number; total: number }[]>`
      select count(*) filter (where l.type = 'office')::int as office,
             count(*) filter (where l.type = 'facility')::int as facilities,
             count(*) filter (where l.type = 'partner_stock')::int as partners,
             count(*) filter (where u.status = 'in_repair')::int as repair,
             count(*)::int as total
      from units u join locations l on l.id = u.location_id
      where u.status not in ('retired', 'returned_to_supplier')`;
    const stages = await tx<{ stage: string; n: number }[]>`
      select stage::text, count(*)::int as n from facilities where is_active group by 1`;
    const [{ routersWithoutSim }] = await tx<{ routersWithoutSim: number }[]>`
      select count(*)::int as "routersWithoutSim" from units u join products p on p.id = u.product_id
      where p.requires_configuration and u.location_id = office_location_id() and u.status in ('in_office', 'configured')
        and not exists (select 1 from sim_assignments a where a.router_unit_id = u.id and a.ended_at is null)`;
    const [{ pendingUsers }] = await tx<{ pendingUsers: number }[]>`
      select count(*)::int as "pendingUsers" from users where status = 'pending'`;
    return { where, stages: Object.fromEntries(stages.map((r) => [r.stage, r.n])) as Record<string, number>,
             routersWithoutSim, pendingUsers };
  });
}

// ---------------------------------------------------------------------------------------------
// Counted (hybrid) items still waiting for serial numbers, per delivery line (Device preparation).
// ---------------------------------------------------------------------------------------------
export type PendingSerialLine = { batchLineId: number; batchCode: string; product: string; received: number; serialised: number };

export async function pendingSerialLines(userId: string): Promise<PendingSerialLine[]> {
  return read(userId, (tx) => tx<PendingSerialLine[]>`
    select bl.id::int as "batchLineId", b.code as "batchCode", p.name as product, bl.quantity_received as received,
           (select count(*)::int from units u where u.batch_line_id = bl.id) as serialised
    from batch_lines bl join batches b on b.id = bl.batch_id join products p on p.id = bl.product_id
    where p.tracking_type = 'hybrid'
      and (select count(*) from units u where u.batch_line_id = bl.id) < bl.quantity_received
    order by b.received_on, bl.id`);
}

// ---------------------------------------------------------------------------------------------
// Units that can be put on a deployment or shipment from a place: really there, usable, not already
// planned on another open document, and not a SIM inside a router (it travels with the router).
// ---------------------------------------------------------------------------------------------
export type AvailableUnit = {
  unitId: number; serial: string; product: string; status: string; simIccid: string | null; ipAddress: string | null;
  needsConfiguration: boolean;
};

export async function availableUnits(userId: string, rawInput: unknown): Promise<AvailableUnit[]> {
  const { locationId } = parseInput(z.object({ locationId: z.number().int().positive() }), rawInput);
  return read(userId, (tx) => tx<AvailableUnit[]>`
    select u.id::int as "unitId", u.serial_number as serial, p.name as product, u.status::text as status,
           s.serial_number as "simIccid", host(a.ip_address) as "ipAddress",
           p.requires_configuration as "needsConfiguration"
    from units u join products p on p.id = u.product_id
    left join sim_assignments a on a.router_unit_id = u.id and a.ended_at is null
    left join units s on s.id = a.sim_unit_id
    where u.location_id = ${locationId}
      and u.status in ('in_office', 'configured', 'shipped_to_partner')
      and not exists (select 1 from sim_assignments x where x.sim_unit_id = u.id and x.ended_at is null)
      and not exists (select 1 from deployment_items i join deployments d on d.id = i.deployment_id
                      where i.unit_id = u.id and i.removed_at is null and d.status in ('draft', 'scheduled'))
      and not exists (select 1 from shipment_items i join shipments sh on sh.id = i.shipment_id
                      where i.unit_id = u.id and i.removed_at is null and sh.status = 'draft')
    order by p.name, u.serial_number
    limit 500`);
}

// Counted stock at one place (for adding cables to a document, or returning them).
export type CountedStock = { productId: number; product: string; quantity: number };

export async function countedStockAt(userId: string, rawInput: unknown): Promise<CountedStock[]> {
  const { locationId } = parseInput(z.object({ locationId: z.number().int().positive() }), rawInput);
  return read(userId, (tx) => tx<CountedStock[]>`
    select s.product_id::int as "productId", p.name as product, s.quantity
    from stock_levels s join products p on p.id = s.product_id
    where s.location_id = ${locationId} and s.quantity > 0 order by p.name`);
}
