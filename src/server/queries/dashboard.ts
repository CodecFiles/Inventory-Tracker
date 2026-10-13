import "server-only";
import { read } from "./read";

// The dashboard's panels (design/Main.dc.html) from real data: the lifecycle of every unit, a card
// per category, three small charts, recent deliveries, upcoming deployments and recent stock moves.
//
// Definitions used below:
//   reserved  = on an open deployment (draft or scheduled) or a draft shipment
//   POC       = at a facility, and the last deployment that moved it there was a POC (a SIM inside
//               a router moves with the router's deployment, so it counts the same)
//   contract  = at a facility otherwise (contract deployments, or installed some other way)

export type LifecycleCounts = {
  office: number; ready: number; reserved: number; partners: number; poc: number; contract: number;
  repair: number; other: number; pocFacilities: number; contractFacilities: number; total: number;
};
export type CategoryCounts = {
  categoryId: number; category: string; models: string; total: number;
  inStock: number; reserved: number; deployed: number; partners: number; repair: number; poc: number; contract: number;
};
export type MonthCounts = { month: string; received: number; deployed: number };
export type RecentBatch = { id: number; code: string; receivedOn: Date; product: string; lines: number; quantity: number };
export type UpcomingDeployment = {
  id: number; code: string; date: Date | null; type: string; status: string; facility: string; facilityId: number; items: number;
};
export type Activity = { who: string; type: string; product: string; quantity: number; place: string | null; batch: string | null; at: Date };

export async function dashboardPanels(userId: string) {
  return read(userId, async (sql) => {
    const units = sql`
      with live as (
        select u.id, u.status, l.type as ltype, u.location_id, p.category_id, p.model,
               exists (select 1 from deployment_items i join deployments d on d.id = i.deployment_id
                       where i.unit_id = u.id and i.removed_at is null and d.status in ('draft', 'scheduled'))
               or exists (select 1 from shipment_items i join shipments s on s.id = i.shipment_id
                          where i.unit_id = u.id and i.removed_at is null and s.status = 'draft') as reserved,
               (select d.deployment_type from stock_movements m join deployments d on d.id = m.deployment_id
                where m.unit_id = u.id and m.movement_type in ('deploy', 'deploy_abroad')
                order by m.moved_at desc, m.id desc limit 1) as dep_type
        from units u join products p on p.id = u.product_id join locations l on l.id = u.location_id
        where u.status not in ('retired', 'returned_to_supplier')
      )`;
    const [[life], categories, months, [totals], batches, upcoming, activity] = await Promise.all([
      sql<LifecycleCounts[]>`
        ${units}
        select count(*) filter (where ltype = 'office' and status = 'in_office' and not reserved)::int as office,
               count(*) filter (where ltype = 'office' and status = 'configured' and not reserved)::int as ready,
               count(*) filter (where reserved)::int as reserved,
               count(*) filter (where status = 'shipped_to_partner' and not reserved)::int as partners,
               count(*) filter (where ltype = 'facility' and dep_type = 'poc')::int as poc,
               count(*) filter (where ltype = 'facility' and dep_type is distinct from 'poc')::int as contract,
               count(*) filter (where status = 'in_repair')::int as repair,
               count(distinct location_id) filter (where ltype = 'facility' and dep_type = 'poc')::int as "pocFacilities",
               count(distinct location_id) filter (where ltype = 'facility' and dep_type is distinct from 'poc')::int as "contractFacilities",
               count(*)::int as total,
               0 as other
        from live`,
      sql<CategoryCounts[]>`
        ${units}
        select c.id::int as "categoryId", c.name as category,
               coalesce(string_agg(distinct live.model, ' · '), '') as models,
               count(*)::int as total,
               count(*) filter (where ltype = 'office' and status in ('in_office', 'configured') and not reserved)::int as "inStock",
               count(*) filter (where reserved)::int as reserved,
               count(*) filter (where ltype = 'facility')::int as deployed,
               count(*) filter (where status = 'shipped_to_partner' and not reserved)::int as partners,
               count(*) filter (where status = 'in_repair')::int as repair,
               count(*) filter (where ltype = 'facility' and dep_type = 'poc')::int as poc,
               count(*) filter (where ltype = 'facility' and dep_type is distinct from 'poc')::int as contract
        from live join categories c on c.id = live.category_id
        group by c.id, c.name order by count(*) desc, c.name`,
      // serialised units received and deployed per month, the last 7 months (Oman time)
      sql<MonthCounts[]>`
        select to_char(m, 'Mon') as month,
               count(s.id) filter (where s.movement_type = 'receive')::int as received,
               count(s.id) filter (where s.movement_type in ('deploy', 'deploy_abroad'))::int as deployed
        from generate_series(date_trunc('month', now() at time zone 'Asia/Muscat') - interval '6 months',
                             date_trunc('month', now() at time zone 'Asia/Muscat'), interval '1 month') m
        left join stock_movements s on s.unit_id is not null
              and s.movement_type in ('receive', 'deploy', 'deploy_abroad')
              and date_trunc('month', s.moved_at at time zone 'Asia/Muscat') = m
        group by m order by m`,
      sql<{ products: number; categories: number; counted: number }[]>`
        select (select count(*)::int from products where is_active) as products,
               (select count(distinct category_id)::int from products where is_active) as categories,
               (select coalesce(sum(quantity), 0)::int from stock_levels) as counted`,
      sql<RecentBatch[]>`
        select b.id::int, b.code, b.received_on as "receivedOn",
               (select p.name from batch_lines bl join products p on p.id = bl.product_id
                where bl.batch_id = b.id order by bl.id limit 1) as product,
               (select count(*)::int from batch_lines bl where bl.batch_id = b.id) as lines,
               (select coalesce(sum(bl.quantity_received), 0)::int from batch_lines bl where bl.batch_id = b.id) as quantity
        from batches b order by b.received_on desc, b.id desc limit 5`,
      sql<UpcomingDeployment[]>`
        select d.id::int, d.code, d.deployment_date as date, d.deployment_type::text as type, d.status::text as status,
               f.name as facility, f.id::int as "facilityId",
               (select coalesce(sum(i.quantity), 0)::int from deployment_items i
                where i.deployment_id = d.id and i.removed_at is null) as items
        from deployments d join facilities f on f.id = d.facility_id
        where d.status in ('draft', 'scheduled')
        order by d.deployment_date nulls last, d.id limit 4`,
      // one line per person, kind of move, product, place and minute (a deployment of 4 sensors is one line)
      sql<Activity[]>`
        select u.full_name as who, s.movement_type::text as type, p.name as product, sum(s.quantity)::int as quantity,
               coalesce(tl.name, fl.name) as place, max(b.code) as batch, max(s.moved_at) as at
        from stock_movements s join users u on u.id = s.performed_by join products p on p.id = s.product_id
        left join locations tl on tl.id = s.to_location_id
        left join locations fl on fl.id = s.from_location_id
        left join batches b on b.id = s.batch_id
        group by u.full_name, s.movement_type, p.name, tl.name, fl.name, date_trunc('minute', s.moved_at)
        order by max(s.moved_at) desc limit 6`,
    ]);
    life.other = Math.max(0, life.total - life.office - life.ready - life.reserved - life.partners - life.poc - life.contract);
    return { life, categories, months, totals, batches, upcoming, activity };
  });
}
