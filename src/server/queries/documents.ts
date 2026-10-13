import "server-only";
import { z } from "zod";
import { parseInput, ValidationError } from "../errors";
import { optionalId, Page, read } from "./read";

// Lists and details for deployments, shipments and batches (deliveries).

const idInput = z.object({ id: z.number().int().positive() });

export type DeploymentRow = {
  id: number; code: string; status: string; type: string; date: Date | null; facilityId: number; facility: string;
  country: string; createdBy: string; items: number;
};
export type DeploymentInfo = Omit<DeploymentRow, "items"> & {
  notes: string | null; completedAt: Date | null; completedBy: string | null;
  abroad: boolean; facilityStage: string; sourceLocationId: number | null; source: string | null;
};
export type DocItem = {
  id: number; productId: number; product: string; unitId: number | null; serial: string | null; quantity: number;
  building?: string | null; position?: string | null; removedAt?: Date | null;
};
export type ShipmentRow = {
  id: number; code: string; status: string; shippedOn: Date | null; courier: string | null; trackingNumber: string | null;
  partnerId: number; partner: string; country: string; items: number;
};
export type ShipmentInfo = Omit<ShipmentRow, "items"> & { notes: string | null; createdBy: string; shippedBy: string | null };
export type BatchRow = {
  id: number; code: string; receivedOn: Date; invoiceNumber: string | null; purchaseOrder: string | null;
  supplier: string; receivedBy: string; itemsReceived: number;
};
export type BatchInfo = Omit<BatchRow, "itemsReceived"> & { notes: string | null };
export type BatchLine = { id: number; productId: number; product: string; tracking: string; quantityReceived: number; serialised: number };
export type BatchUnit = { unitId: number; serial: string; product: string; status: string };

export async function listDeployments(userId: string, rawInput: unknown = {}) {
  const f = parseInput(Page.extend({
    status: z.enum(["draft", "scheduled", "completed", "cancelled"]).optional(),
    facilityId: optionalId,
  }), rawInput);
  return read(userId, (tx) => tx<DeploymentRow[]>`
    select d.id::int, d.code, d.status::text as status, d.deployment_type::text as type, d.deployment_date as "date",
           f.id::int as "facilityId", f.name as facility, c.name as country, u.full_name as "createdBy",
           (select count(*)::int from deployment_items i where i.deployment_id = d.id and (i.removed_at is null or d.status = 'completed')) as items
    from deployments d join facilities f on f.id = d.facility_id join countries c on c.id = f.country_id
    join users u on u.id = d.created_by
    where true
      ${f.status ? tx`and d.status = ${f.status}` : tx``}
      ${f.facilityId ? tx`and d.facility_id = ${f.facilityId}` : tx``}
    order by d.id desc limit ${f.limit} offset ${f.offset}`);
}

export async function deploymentDetail(userId: string, rawInput: unknown): Promise<DeploymentInfo & { items: DocItem[] }> {
  const { id } = parseInput(idInput, rawInput);
  return read(userId, async (tx) => {
    const [d] = await tx<DeploymentInfo[]>`
      select d.id::int, d.code, d.status::text as status, d.deployment_type::text as type, d.deployment_date as "date",
             d.notes, d.completed_at as "completedAt", f.id::int as "facilityId", f.name as facility,
             c.name as country, cu.full_name as "createdBy", co.full_name as "completedBy",
             c.iso_code <> 'OM' as abroad, f.stage::text as "facilityStage",
             src.id::int as "sourceLocationId", src.name as source
      from deployments d join facilities f on f.id = d.facility_id join countries c on c.id = f.country_id
      join users cu on cu.id = d.created_by left join users co on co.id = d.completed_by
      left join locations src on src.id = case when c.iso_code = 'OM' then office_location_id()
                                               else (select l.id from locations l where l.partner_id = f.partner_id) end
      where d.id = ${id}`;
    if (!d) throw new ValidationError("That deployment does not exist");
    const items = await tx<DocItem[]>`
      select i.id::int, p.id::int as "productId", p.name as product, u.id::int as "unitId", u.serial_number as serial, i.quantity,
             i.building, i.position, i.removed_at as "removedAt"
      from deployment_items i join products p on p.id = i.product_id left join units u on u.id = i.unit_id
      where i.deployment_id = ${id} and (i.removed_at is null or ${d.status} = 'completed')
      order by i.id`;
    return { ...d, items };
  });
}

export async function listShipments(userId: string, rawInput: unknown = {}) {
  const f = parseInput(Page.extend({
    status: z.enum(["draft", "shipped", "received_by_partner", "cancelled"]).optional(),
    partnerId: optionalId,
  }), rawInput);
  return read(userId, (tx) => tx<ShipmentRow[]>`
    select s.id::int, s.code, s.status::text as status, s.shipped_on as "shippedOn", s.courier,
           s.tracking_number as "trackingNumber", p.id::int as "partnerId", p.name as partner, c.name as country,
           (select count(*)::int from shipment_items i where i.shipment_id = s.id and i.removed_at is null) as items
    from shipments s join partners p on p.id = s.partner_id join countries c on c.id = p.country_id
    where true
      ${f.status ? tx`and s.status = ${f.status}` : tx``}
      ${f.partnerId ? tx`and s.partner_id = ${f.partnerId}` : tx``}
    order by s.id desc limit ${f.limit} offset ${f.offset}`);
}

export async function shipmentDetail(userId: string, rawInput: unknown): Promise<ShipmentInfo & { items: DocItem[] }> {
  const { id } = parseInput(idInput, rawInput);
  return read(userId, async (tx) => {
    const [s] = await tx<ShipmentInfo[]>`
      select s.id::int, s.code, s.status::text as status, s.shipped_on as "shippedOn", s.courier,
             s.tracking_number as "trackingNumber", s.notes, p.id::int as "partnerId", p.name as partner, c.name as country,
             cu.full_name as "createdBy", su.full_name as "shippedBy"
      from shipments s join partners p on p.id = s.partner_id join countries c on c.id = p.country_id
      join users cu on cu.id = s.created_by left join users su on su.id = s.shipped_by
      where s.id = ${id}`;
    if (!s) throw new ValidationError("That shipment does not exist");
    const items = await tx<DocItem[]>`
      select i.id::int, p.id::int as "productId", p.name as product, u.id::int as "unitId", u.serial_number as serial, i.quantity
      from shipment_items i join products p on p.id = i.product_id left join units u on u.id = i.unit_id
      where i.shipment_id = ${id} and i.removed_at is null order by i.id`;
    return { ...s, items };
  });
}

export async function listBatches(userId: string, rawInput: unknown = {}) {
  const f = parseInput(Page.extend({ supplierId: optionalId }), rawInput);
  return read(userId, (tx) => tx<BatchRow[]>`
    select b.id::int, b.code, b.received_on as "receivedOn", b.invoice_number as "invoiceNumber",
           b.purchase_order as "purchaseOrder", s.name as supplier, u.full_name as "receivedBy",
           (select coalesce(sum(quantity_received), 0)::int from batch_lines where batch_id = b.id) as "itemsReceived"
    from batches b join suppliers s on s.id = b.supplier_id join users u on u.id = b.received_by
    where true ${f.supplierId ? tx`and b.supplier_id = ${f.supplierId}` : tx``}
    order by b.received_on desc, b.id desc limit ${f.limit} offset ${f.offset}`);
}

export async function batchDetail(userId: string, rawInput: unknown): Promise<BatchInfo & { lines: BatchLine[]; units: BatchUnit[] }> {
  const { id } = parseInput(idInput, rawInput);
  return read(userId, async (tx) => {
    const [b] = await tx<BatchInfo[]>`
      select b.id::int, b.code, b.received_on as "receivedOn", b.invoice_number as "invoiceNumber",
             b.purchase_order as "purchaseOrder", b.notes, s.name as supplier, u.full_name as "receivedBy"
      from batches b join suppliers s on s.id = b.supplier_id join users u on u.id = b.received_by
      where b.id = ${id}`;
    if (!b) throw new ValidationError("That batch does not exist");
    // for hybrid products, "serialised" shows how many have been given serials so far
    const lines = await tx<BatchLine[]>`
      select bl.id::int, p.id::int as "productId", p.name as product, p.tracking_type::text as tracking, bl.quantity_received as "quantityReceived",
             (select count(*)::int from units where batch_line_id = bl.id) as serialised
      from batch_lines bl join products p on p.id = bl.product_id where bl.batch_id = ${id} order by bl.id`;
    const units = await tx<BatchUnit[]>`
      select u.id::int as "unitId", u.serial_number as serial, p.name as product, u.status::text as status
      from units u join batch_lines bl on bl.id = u.batch_line_id join products p on p.id = u.product_id
      where bl.batch_id = ${id} order by p.name, u.serial_number`;
    return { ...b, lines, units };
  });
}
