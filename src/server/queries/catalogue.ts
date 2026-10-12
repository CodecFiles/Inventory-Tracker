import "server-only";
import { read } from "./read";

// Catalogue lists for the Settings screens — archived records included, so they can be restored.
// "used" = how often the record is already referenced; a product that has been received has its
// kind locked (migration 0012), so the screen can explain that before anyone tries.

export type ProductRow = {
  id: number; name: string; brand: string; model: string; categoryId: number; category: string;
  tracking: string; needsConfiguration: boolean; isSim: boolean; minStock: number; isActive: boolean; received: boolean;
};
export type NamedRow = { id: number; name: string; isActive: boolean; used: number };
export type SupplierRow = NamedRow & { codePrefix: string; email: string | null; phone: string | null };
export type PartnerRow = NamedRow & { countryId: number; country: string; locationId: number;
  contacts: { id: number; name: string; role: string | null; email: string | null; phone: string | null; isPrimary: boolean }[] };

export async function catalogue(userId: string) {
  return read(userId, async (tx) => ({
    products: await tx<ProductRow[]>`
      select p.id::int, p.name, p.brand, p.model, p.category_id::int as "categoryId", c.name as category,
             p.tracking_type::text as tracking, p.requires_configuration as "needsConfiguration", p.is_sim as "isSim",
             p.min_stock_level as "minStock", p.is_active as "isActive",
             exists (select 1 from batch_lines bl where bl.product_id = p.id) as received
      from products p join categories c on c.id = p.category_id
      order by p.is_active desc, c.name, p.name`,
    categories: await tx<NamedRow[]>`
      select c.id::int, c.name, c.is_active as "isActive",
             (select count(*)::int from products p where p.category_id = c.id) as used
      from categories c order by c.is_active desc, c.name`,
    suppliers: await tx<SupplierRow[]>`
      select s.id::int, s.name, s.code_prefix as "codePrefix", s.email, s.phone, s.is_active as "isActive",
             (select count(*)::int from batches b where b.supplier_id = s.id) as used
      from suppliers s order by s.is_active desc, s.name`,
    clients: await tx<NamedRow[]>`
      select c.id::int, c.name, c.is_active as "isActive",
             (select count(*)::int from facilities f where f.client_id = c.id) as used
      from clients c order by c.is_active desc, c.name`,
    partners: await tx<PartnerRow[]>`
      select p.id::int, p.name, p.is_active as "isActive", p.country_id::int as "countryId", c.name as country,
             (select l.id::int from locations l where l.partner_id = p.id) as "locationId",
             (select count(*)::int from facilities f where f.partner_id = p.id) as used,
             coalesce((select json_agg(json_build_object('id', pc.id, 'name', pc.name, 'role', pc.role, 'email', pc.email,
                                                         'phone', pc.phone, 'isPrimary', pc.is_primary) order by pc.is_primary desc, pc.name)
                       from partner_contacts pc where pc.partner_id = p.id), '[]') as contacts
      from partners p join countries c on c.id = p.country_id order by p.is_active desc, p.name`,
    repairCompanies: await tx<NamedRow[]>`
      select r.id::int, r.name, r.is_active as "isActive", 0 as used
      from repair_companies r order by r.is_active desc, r.name`,
  }));
}
