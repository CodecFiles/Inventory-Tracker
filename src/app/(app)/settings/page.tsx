import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { catalogue, type ProductRow } from "@/server/queries/catalogue";
import { getPermissions, requireApprovedUser } from "@/server/session";
import {
  addCategory, addProduct, addRepairCompany, addSupplier, editProduct, editSupplier, renameCategory, setArchived,
} from "./actions";

// Settings (design/Settings.dc.html): the catalogue every other screen uses. Facilities, clients and
// partners join in step 6.4. Records are archived, never deleted (C1).

const TABS = [
  { key: "products", label: "Products", permission: "products.manage" },
  { key: "categories", label: "Categories", permission: "products.manage" },
  { key: "suppliers", label: "Suppliers", permission: "suppliers.manage" },
  { key: "repair", label: "Repair companies", permission: "suppliers.manage" },
] as const;

const TRACKING_SHORT: Record<string, string> = { serialised: "Serial numbers", quantity: "Counted", hybrid: "Counted → serials" };
const TRACKING: Record<string, string> = {
  serialised: "One by one (serial numbers)",
  quantity: "Counted (no serial numbers)",
  hybrid: "Counted now, serial numbers later",
};

function Archived({ active }: { active: boolean }) {
  return active ? null : <span className="b s-retired" style={{ marginLeft: 8 }}>Archived</span>;
}

function ArchiveButton({ kind, id, active }: { kind: "product" | "category" | "supplier" | "repairCompany"; id: number; active: boolean }) {
  return (
    <ActionForm action={setArchived.bind(null, kind, id, active)} submit={active ? "Archive" : "Restore"} danger={active}
                confirm={active ? "Archive this? It will be hidden from new work; its history stays." : undefined} />
  );
}

function ProductFields({ p, categories }: { p?: ProductRow; categories: { id: number; name: string; isActive: boolean }[] }) {
  const locked = p?.received;
  return (
    <>
      <label className="fl">Name<input className="fld" name="name" defaultValue={p?.name} required placeholder="e.g. TRB140 LTE router" /></label>
      <label className="fl">Brand<input className="fld" name="brand" defaultValue={p?.brand} required placeholder="e.g. Teltonika" /></label>
      <label className="fl">Model<input className="fld" name="model" defaultValue={p?.model} required placeholder="e.g. TRB140" /></label>
      <label className="fl">Category
        <select className="fld" name="categoryId" defaultValue={p?.categoryId ?? ""} required>
          <option value="" disabled>Choose…</option>
          {categories.filter((c) => c.isActive || c.id === p?.categoryId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="fl">How it is tracked
        <select className="fld" name="trackingType" defaultValue={p?.tracking ?? "serialised"} disabled={locked}>
          {Object.entries(TRACKING).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {locked && <input type="hidden" name="trackingType" value={p.tracking} />}
      </label>
      <label className="fl">Minimum stock in the office<input className="fld" name="minStockLevel" type="number" min={0} defaultValue={p?.minStock ?? 0} /></label>
      <label className="fl" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input type="checkbox" name="requiresConfiguration" defaultChecked={p?.needsConfiguration} disabled={locked} />
        Needs configuration (a router that gets a SIM)
        {locked && p.needsConfiguration && <input type="hidden" name="requiresConfiguration" value="on" />}
      </label>
      <label className="fl" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input type="checkbox" name="isSim" defaultChecked={p?.isSim} disabled={locked} />
        Is a SIM card (serial = ICCID)
        {locked && p.isSim && <input type="hidden" name="isSim" value="on" />}
      </label>
      {locked && <p className="hint" style={{ flexBasis: "100%" }}>This product has been received, so how it is tracked can no longer change.</p>}
    </>
  );
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireApprovedUser();
  const permissions = await getPermissions(user.id);
  const tabs = TABS.filter((t) => permissions.has(t.permission));
  if (tabs.length === 0) {
    return <main className="main"><div className="alert err">You do not have permission to change settings.</div></main>;
  }
  const { tab } = await searchParams;
  const current = tabs.find((t) => t.key === tab) ?? tabs[0];
  const data = await catalogue(user.id);

  return (
    <main className="main">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <nav aria-label="Breadcrumb" className="bc"><Link href="/">Dashboard</Link><span aria-hidden="true">/</span><span>Settings</span><span aria-hidden="true">/</span><span>{current.label}</span></nav>
        <h1 className="h1">Settings</h1>
        <p className="muted">The catalogue every other screen uses. Records are archived, never deleted, and every change is in the audit log.</p>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <aside className="card sside">
          <nav className="snav" aria-label="Settings sections">
            <span className="sgrp">Catalogue</span>
            {tabs.map((t) => (
              <Link key={t.key} href={`/settings?tab=${t.key}`} className={t.key === current.key ? "sbtn on" : "sbtn"}
                    aria-current={t.key === current.key ? "page" : undefined}>{t.label}</Link>
            ))}
          </nav>
        </aside>

        <div style={{ flex: "1 1 600px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {current.key === "products" && (
            <>
              <section className="card">
                <div className="sh"><div><h2>Add a product</h2><p>A product is a model you stock, e.g. “TRB140 LTE router”. Each delivery of it is received as a batch.</p></div></div>
                <div style={{ padding: "0 18px 18px" }}>
                  {data.categories.some((c) => c.isActive) ? (
                    <ActionForm action={addProduct} submit="Add product" className="formrow"><ProductFields categories={data.categories} /></ActionForm>
                  ) : (
                    <div className="alert warn">Add a category first (e.g. “Routers”).</div>
                  )}
                </div>
              </section>
              <section className="card">
                <div className="sh"><h2>Products</h2></div>
                {data.products.length === 0 ? <div className="empty">No products yet.</div> : (
                  <div className="tw">
                    <table className="tbl">
                      <thead><tr><th>Product</th><th>Category</th><th>Tracking</th><th className="num">Minimum</th><th /></tr></thead>
                      <tbody>
                        {data.products.map((p) => (
                          <tr key={p.id}>
                            <td style={{ whiteSpace: "normal" }}>
                              <details className="edit">
                                <summary><span style={{ fontWeight: 500 }}>{p.name}</span><Archived active={p.isActive} />
                                  <div className="muted" style={{ fontSize: 12 }}>{p.brand} {p.model} · <span className="lnk">Edit</span></div>
                                </summary>
                                <ActionForm action={editProduct.bind(null, p.id)} submit="Save" className="formrow" style={{ padding: "12px 0", minWidth: 520 }}>
                                  <ProductFields p={p} categories={data.categories} />
                                </ActionForm>
                              </details>
                            </td>
                            <td>{p.category}</td>
                            <td>
                              {TRACKING_SHORT[p.tracking]}
                              {p.needsConfiguration && <span className="b s-prep" style={{ marginLeft: 6 }}>Router</span>}
                              {p.isSim && <span className="b s-transit" style={{ marginLeft: 6 }}>SIM</span>}
                            </td>
                            <td className="num">{p.minStock}</td>
                            <td><ArchiveButton kind="product" id={p.id} active={p.isActive} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {current.key === "categories" && (
            <section className="card">
              <div className="sh"><div><h2>Categories</h2><p>Groups of products, e.g. Routers, SIM cards, Sensors, Cables.</p></div></div>
              <div style={{ padding: "0 18px 18px" }}>
                <ActionForm action={addCategory} submit="Add category" className="formrow">
                  <label className="fl">New category<input className="fld" name="name" required placeholder="e.g. Routers" /></label>
                </ActionForm>
              </div>
              {data.categories.map((c) => (
                <div key={c.id} className="row" style={{ flexWrap: "wrap" }}>
                  <details className="edit" style={{ flex: 1 }}>
                    <summary><span style={{ fontWeight: 500 }}>{c.name}</span><Archived active={c.isActive} />
                      <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{c.used} products · <span className="lnk">Rename</span></span>
                    </summary>
                    <ActionForm action={renameCategory.bind(null, c.id)} submit="Save" className="formrow" style={{ paddingTop: 10 }}>
                      <label className="fl">Name<input className="fld" name="name" defaultValue={c.name} required /></label>
                    </ActionForm>
                  </details>
                  <ArchiveButton kind="category" id={c.id} active={c.isActive} />
                </div>
              ))}
            </section>
          )}

          {current.key === "suppliers" && (
            <section className="card">
              <div className="sh"><div><h2>Suppliers</h2><p>The batch-code prefix (2–5 letters) starts every batch code from this supplier, e.g. TEL-2026-001.</p></div></div>
              <div style={{ padding: "0 18px 18px" }}>
                <ActionForm action={addSupplier} submit="Add supplier" className="formrow">
                  <label className="fl">Name<input className="fld" name="name" required placeholder="e.g. Teltonika Distributor" /></label>
                  <label className="fl">Batch-code prefix<input className="fld mono" name="codePrefix" required maxLength={5} placeholder="TEL" /></label>
                  <label className="fl">Email<input className="fld" name="email" type="email" /></label>
                  <label className="fl">Phone<input className="fld" name="phone" /></label>
                </ActionForm>
              </div>
              {data.suppliers.map((s) => (
                <div key={s.id} className="row" style={{ flexWrap: "wrap" }}>
                  <details className="edit" style={{ flex: 1 }}>
                    <summary><span style={{ fontWeight: 500 }}>{s.name}</span> <span className="mono muted">{s.codePrefix}</span><Archived active={s.isActive} />
                      <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{s.used} batches · <span className="lnk">Edit</span></span>
                    </summary>
                    <ActionForm action={editSupplier.bind(null, s.id)} submit="Save" className="formrow" style={{ paddingTop: 10 }}>
                      <label className="fl">Name<input className="fld" name="name" defaultValue={s.name} required /></label>
                      <label className="fl">Batch-code prefix<input className="fld mono" name="codePrefix" defaultValue={s.codePrefix} required maxLength={5} /></label>
                      <label className="fl">Email<input className="fld" name="email" type="email" defaultValue={s.email ?? ""} /></label>
                      <label className="fl">Phone<input className="fld" name="phone" defaultValue={s.phone ?? ""} /></label>
                    </ActionForm>
                  </details>
                  <ArchiveButton kind="supplier" id={s.id} active={s.isActive} />
                </div>
              ))}
            </section>
          )}

          {current.key === "repair" && (
            <section className="card">
              <div className="sh"><div><h2>Repair companies</h2><p>Outside companies that repair items (suppliers can repair too).</p></div></div>
              <div style={{ padding: "0 18px 18px" }}>
                <ActionForm action={addRepairCompany} submit="Add repair company" className="formrow">
                  <label className="fl">Name<input className="fld" name="name" required /></label>
                  <label className="fl">Email<input className="fld" name="email" type="email" /></label>
                  <label className="fl">Phone<input className="fld" name="phone" /></label>
                </ActionForm>
              </div>
              {data.repairCompanies.map((r) => (
                <div key={r.id} className="row">
                  <span style={{ flex: 1, fontWeight: 500 }}>{r.name}<Archived active={r.isActive} /></span>
                  <ArchiveButton kind="repairCompany" id={r.id} active={r.isActive} />
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
