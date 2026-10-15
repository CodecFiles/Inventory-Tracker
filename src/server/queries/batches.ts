import "server-only";
import { z } from "zod";
import { ValidationError, parseInput } from "../errors";
import { inOrder, likePattern, optionalId, Page, read } from "./read";

// Batches (design/Batches.dc.html, BatchDetail.dc.html): every delivery and where each unit from it
// is today. Totals are worked out with joins and GROUP BY, never one look-up per row (see the
// dashboard note in dashboard.ts: per-row look-ups make PostgreSQL over-estimate and slow down).

// Unit states, grouped the way the screens show them
const STATE_COUNTS = `
  count(*)::int as units,
  count(*) filter (where un.status = 'in_office')::int as "inStock",
  count(*) filter (where un.status = 'configured')::int as ready,
  count(*) filter (where un.status in ('deployed', 'deployed_abroad'))::int as deployed,
  count(*) filter (where un.status = 'shipped_to_partner')::int as partners,
  count(*) filter (where un.status = 'in_repair')::int as repair,
  count(*) filter (where un.status in ('retired', 'returned_to_supplier'))::int as gone,
  count(*) filter (where l.type = 'office' and un.status in ('in_office', 'configured'))::int as available`;

export type StateCounts = {
  units: number; inStock: number; ready: number; deployed: number; partners: number; repair: number; gone: number; available: number;
};

export type BatchListRow = StateCounts & {
  id: number; code: string; receivedOn: Date; invoiceNumber: string | null; purchaseOrder: string | null;
  supplierId: number; supplier: string; receivedBy: string;
  lines: number; quantity: number; product: string; category: string; tracking: string;
};

export const BatchListInput = Page.extend({
  q: z.string().trim().max(100).optional(),
  supplierId: optionalId,
  categoryId: optionalId,
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export async function batchList(userId: string, rawInput: unknown = {}) {
  const f = parseInput(BatchListInput, rawInput);
  return read(userId, async (sql) => {
    const [rows, [summary], categories] = await inOrder([
      () => sql<(BatchListRow & { total: number })[]>`
        with line as (
          select bl.batch_id, count(*)::int as lines, sum(bl.quantity_received)::int as quantity,
                 (array_agg(p.name order by bl.id))[1] as product,
                 (array_agg(c.name order by bl.id))[1] as category,
                 (array_agg(p.tracking_type::text order by bl.id))[1] as tracking,
                 string_agg(p.name, ' ') as names, array_agg(p.category_id) as categories
          from batch_lines bl join products p on p.id = bl.product_id join categories c on c.id = p.category_id
          group by bl.batch_id
        ), state as (
          select bl.batch_id, ${sql.unsafe(STATE_COUNTS)}
          from units un join batch_lines bl on bl.id = un.batch_line_id join locations l on l.id = un.location_id
          group by bl.batch_id
        )
        select b.id::int, b.code, b.received_on as "receivedOn", b.invoice_number as "invoiceNumber",
               b.purchase_order as "purchaseOrder", s.id::int as "supplierId", s.name as supplier, us.full_name as "receivedBy",
               line.lines, line.quantity, line.product, line.category, line.tracking,
               coalesce(st.units, 0) as units, coalesce(st."inStock", 0) as "inStock", coalesce(st.ready, 0) as ready,
               coalesce(st.deployed, 0) as deployed, coalesce(st.partners, 0) as partners, coalesce(st.repair, 0) as repair,
               coalesce(st.gone, 0) as gone, coalesce(st.available, 0) as available,
               count(*) over ()::int as total
        from batches b
        join suppliers s on s.id = b.supplier_id
        join users us on us.id = b.received_by
        join line on line.batch_id = b.id
        left join state st on st.batch_id = b.id
        where true
          ${f.supplierId ? sql`and b.supplier_id = ${f.supplierId}` : sql``}
          ${f.categoryId ? sql`and ${f.categoryId} = any(line.categories)` : sql``}
          ${f.from ? sql`and b.received_on >= ${f.from}` : sql``}
          ${f.to ? sql`and b.received_on <= ${f.to}` : sql``}
          ${f.q ? sql`and (b.code ilike ${likePattern(f.q)} or b.invoice_number ilike ${likePattern(f.q)}
                          or b.purchase_order ilike ${likePattern(f.q)} or line.names ilike ${likePattern(f.q)})` : sql``}
        order by b.received_on desc, b.id desc
        limit ${f.limit} offset ${f.offset}`,
      // the tiles at the top: always for all batches
      () => sql<{ batches: number; thisQuarter: number; lastQuarter: number; received: number; units: number; deployed: number;
                  noInvoice: number; repair: number; repairBatches: number }[]>`
        with u as (
          select bl.batch_id, un.status from units un join batch_lines bl on bl.id = un.batch_line_id
        )
        select (select count(*)::int from batches) as batches,
               (select count(*)::int from batches where received_on >= date_trunc('quarter', current_date)) as "thisQuarter",
               (select count(*)::int from batches where received_on >= date_trunc('quarter', current_date) - interval '3 months'
                                                      and received_on < date_trunc('quarter', current_date)) as "lastQuarter",
               (select coalesce(sum(quantity_received), 0)::int from batch_lines) as received,
               (select count(*)::int from u) as units,
               (select count(*)::int from u where status in ('deployed', 'deployed_abroad')) as deployed,
               (select count(*)::int from batches where invoice_number is null) as "noInvoice",
               (select count(*)::int from u where status = 'in_repair') as repair,
               (select count(distinct batch_id)::int from u where status = 'in_repair') as "repairBatches"`,
      () => sql<{ id: number; name: string; batches: number }[]>`
        select c.id::int, c.name, count(distinct bl.batch_id)::int as batches
        from batch_lines bl join products p on p.id = bl.product_id join categories c on c.id = p.category_id
        group by c.id, c.name order by c.name`,
    ] as const);
    return { rows, total: rows[0]?.total ?? 0, summary, categories };
  });
}

// ---------------------------------------------------------------------------------------------
// One batch: what arrived, where each unit is now, what happened to it, and where it went.
// ---------------------------------------------------------------------------------------------
export type BatchHeader = {
  id: number; code: string; receivedOn: Date; createdAt: Date; invoiceNumber: string | null; purchaseOrder: string | null;
  notes: string | null; supplierId: number; supplier: string; receivedBy: string;
  supplierBatches: number; supplierUnits: number;
};
export type BatchProductLine = {
  id: number; productId: number; product: string; category: string; tracking: string; needsConfiguration: boolean;
  isSim: boolean; quantityReceived: number; serialised: number;
};
export type BatchUnitRow = {
  unitId: number; serial: string; imei: string | null; product: string; status: string; location: string; place: string;
  needsConfiguration: boolean; isSim: boolean; simIccid: string | null; inRouter: string | null; ipAddress: string | null;
};
export type BatchDeploymentRow = {
  deploymentId: number; code: string; date: Date | null; type: string; facilityId: number; facility: string; place: string | null;
  unitId: number; serial: string; simIccid: string | null; ipAddress: string | null; by: string | null;
};
export type BatchActivity = { who: string; type: string; product: string; quantity: number; place: string | null; document: string | null; at: Date };

export async function batchFull(userId: string, rawInput: unknown) {
  const { id } = parseInput(z.object({ id: z.number().int().positive() }), rawInput);
  return read(userId, async (sql) => {
    const [[header], lines, units, deployments, activity] = await inOrder([
      () => sql<BatchHeader[]>`
        select b.id::int, b.code, b.received_on as "receivedOn", b.created_at as "createdAt",
               b.invoice_number as "invoiceNumber", b.purchase_order as "purchaseOrder", b.notes,
               s.id::int as "supplierId", s.name as supplier, us.full_name as "receivedBy",
               sb.batches as "supplierBatches", sb.units as "supplierUnits"
        from batches b join suppliers s on s.id = b.supplier_id join users us on us.id = b.received_by
        cross join lateral (
          select count(distinct b2.id)::int as batches, coalesce(sum(bl2.quantity_received), 0)::int as units
          from batches b2 join batch_lines bl2 on bl2.batch_id = b2.id where b2.supplier_id = b.supplier_id
        ) sb
        where b.id = ${id}`,
      () => sql<BatchProductLine[]>`
        select bl.id::int, p.id::int as "productId", p.name as product, c.name as category, p.tracking_type::text as tracking,
               p.requires_configuration as "needsConfiguration", p.is_sim as "isSim",
               bl.quantity_received as "quantityReceived", count(un.id)::int as serialised
        from batch_lines bl join products p on p.id = bl.product_id join categories c on c.id = p.category_id
        left join units un on un.batch_line_id = bl.id
        where bl.batch_id = ${id}
        group by bl.id, p.id, c.name order by bl.id`,
      () => sql<BatchUnitRow[]>`
        select un.id::int as "unitId", un.serial_number as serial, un.imei, p.name as product, un.status::text as status,
               l.name as location, l.type::text as place, p.requires_configuration as "needsConfiguration", p.is_sim as "isSim",
               rs.serial_number as "simIccid", sr.serial_number as "inRouter",
               host(coalesce(ra.ip_address, sa.ip_address)) as "ipAddress"
        from units un
        join batch_lines bl on bl.id = un.batch_line_id
        join products p on p.id = un.product_id
        join locations l on l.id = un.location_id
        left join sim_assignments ra on ra.router_unit_id = un.id and ra.ended_at is null
        left join units rs on rs.id = ra.sim_unit_id
        left join sim_assignments sa on sa.sim_unit_id = un.id and sa.ended_at is null
        left join units sr on sr.id = sa.router_unit_id
        where bl.batch_id = ${id}
        order by p.name, un.serial_number`,
      // every time a unit from this batch went out on a deployment (newest first)
      () => sql<BatchDeploymentRow[]>`
        select d.id::int as "deploymentId", d.code, d.deployment_date as date, d.deployment_type::text as type,
               f.id::int as "facilityId", f.name as facility, f.city as place,
               un.id::int as "unitId", un.serial_number as serial,
               rs.serial_number as "simIccid", host(ra.ip_address) as "ipAddress", cb.full_name as by
        from stock_movements m
        join units un on un.id = m.unit_id
        join batch_lines bl on bl.id = un.batch_line_id
        join deployments d on d.id = m.deployment_id
        join facilities f on f.id = d.facility_id
        left join users cb on cb.id = d.completed_by
        left join sim_assignments ra on ra.router_unit_id = un.id and ra.ended_at is null
        left join units rs on rs.id = ra.sim_unit_id
        where bl.batch_id = ${id} and m.movement_type in ('deploy', 'deploy_abroad')
        order by m.moved_at desc, m.id desc limit 50`,
      // what happened to this batch's units: one line per person, kind of move, product, place and minute
      () => sql<BatchActivity[]>`
        select us.full_name as who, m.movement_type::text as type, p.name as product, sum(m.quantity)::int as quantity,
               coalesce(tl.name, fl.name) as place, max(coalesce(dp.code, sh.code)) as document, max(m.moved_at) as at
        from stock_movements m
        join products p on p.id = m.product_id
        join users us on us.id = m.performed_by
        left join units un on un.id = m.unit_id
        left join batch_lines bl on bl.id = un.batch_line_id
        left join locations tl on tl.id = m.to_location_id
        left join locations fl on fl.id = m.from_location_id
        left join deployments dp on dp.id = m.deployment_id
        left join shipments sh on sh.id = m.shipment_id
        where m.batch_id = ${id} or bl.batch_id = ${id}
        group by us.full_name, m.movement_type, p.name, tl.name, fl.name, date_trunc('minute', m.moved_at)
        order by max(m.moved_at) desc limit 12`,
    ] as const);
    if (!header) throw new ValidationError("That batch does not exist");
    return { ...header, lines, units, deployments, activity };
  });
}
