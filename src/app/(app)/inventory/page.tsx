import Form from "next/form";
import Link from "next/link";
import { UNIT_STATUSES, UnitStatus } from "@/components/status";
import { listUnits, stockOverview, unitStatusCounts } from "@/server/queries/inventory";
import { lookups } from "@/server/queries/places";
import { getPermissions, requireApprovedUser } from "@/server/session";

// All inventory (design/Inventory.dc.html). Filters live in the address (?status=…&productId=…),
// so a filtered list can be bookmarked or shared, and the page needs no browser code.

const PAGE = 50;
const PLACES: Record<string, string> = {
  office: "MRD Office", facility: "At a facility", partner_stock: "With a partner",
  repair_company: "Repair company", supplier: "At supplier",
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const user = await requireApprovedUser();
  const sp = (await searchParams) as Params;
  const productId = one(sp.productId) ? Number(sp.productId) : undefined;
  const status = one(sp.status);
  const place = one(sp.place);
  const q = one(sp.q);
  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);

  const [permissions, data, counts, stock, lists] = await Promise.all([
    getPermissions(user.id),
    listUnits(user.id, { productId, status, place, q, limit: PAGE, offset: (page - 1) * PAGE }),
    unitStatusCounts(user.id, { productId }),
    stockOverview(user.id),
    lookups(user.id),
  ]);
  const counted = stock.filter((s) => s.tracking !== "serialised" && (!productId || s.productId === productId));
  const totalUnits = Object.values(counts).reduce((a, b) => a + b, 0);

  // keeps the other filters when one changes
  const href = (change: Params) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ productId: one(sp.productId), status, place, q, ...change })) {
      if (typeof v === "string" && v !== "") next.set(k, v);
    }
    const s = next.toString();
    return s ? `/inventory?${s}` : "/inventory";
  };

  return (
    <main className="main">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <nav aria-label="Breadcrumb" className="bc"><Link href="/">Dashboard</Link><span aria-hidden="true">/</span><span>All inventory</span></nav>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 className="h1">All inventory</h1>
            <p className="muted">{totalUnits} serialised units · {counted.reduce((a, s) => a + s.inOffice + s.atFacilities + s.atPartners, 0)} counted pieces</p>
          </div>
          {permissions.has("inventory.receive") && <Link className="btn p" href="/receive">Receive stock</Link>}
        </div>
      </div>

      <section className="card" aria-label="Filter by status" style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <span className="ov">By status</span><span className="muted" style={{ fontSize: 12.5 }}>Click a status to filter the list</span>
        </div>
        <div className="cg" style={{ alignSelf: "flex-start" }}>
          <Link className={status ? "chip" : "chip on"} href={href({ status: undefined, page: undefined })}>All<span className="cn">{totalUnits}</span></Link>
          {UNIT_STATUSES.map(([key, label]) => (
            <Link key={key} className={status === key ? "chip on" : "chip"} href={href({ status: key, page: undefined })} aria-current={status === key ? "true" : undefined}>
              {label}<span className="cn">{counts[key] ?? 0}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card">
        <Form action="/inventory" style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "14px 18px", borderBottom: "1px solid #EEF1F4" }}>
          {status && <input type="hidden" name="status" value={status} />}
          <input className="fld" name="q" defaultValue={q} placeholder="Serial, IMEI or phone number…" aria-label="Search inventory" style={{ flex: "1 1 240px", width: "auto" }} />
          <select className="fld" name="productId" defaultValue={productId ?? ""} aria-label="Product" style={{ flex: "0 1 240px", width: "auto" }}>
            <option value="">All products</option>
            {lists.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="fld" name="place" defaultValue={place ?? ""} aria-label="Where" style={{ flex: "0 1 200px", width: "auto" }}>
            <option value="">Anywhere</option>
            {Object.entries(PLACES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button type="submit" className="btn">Filter</button>
          {(q || productId || place || status) && <Link className="btn" href="/inventory">Clear all</Link>}
        </Form>

        {data.rows.length === 0 ? (
          <div className="empty">{totalUnits === 0 ? "No serialised items yet — receive a delivery to add some." : "No items match these filters."}</div>
        ) : (
          <div className="tw">
            <table className="tbl">
              <thead><tr><th>Product</th><th>Serial / ICCID</th><th>Batch</th><th>Status</th><th>Location</th><th>SIM · IP / router</th></tr></thead>
              <tbody>
                {data.rows.map((u) => (
                  <tr key={u.unitId}>
                    <td>{u.product}</td>
                    <td className="mono"><Link href={`/inventory/${u.unitId}`}>{u.serial}</Link></td>
                    <td className="mono muted">{u.batchCode}</td>
                    <td><UnitStatus status={u.status} /></td>
                    <td>{u.location}</td>
                    <td className="mono muted">
                      {u.simIccid ? `${u.simIccid}${u.ipAddress ? ` · ${u.ipAddress}` : ""}` : u.inRouter ? `in ${u.inRouter}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.total > PAGE && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderTop: "1px solid #EEF1F4", fontSize: 13 }}>
            <span className="muted">{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, data.total)} of {data.total}</span>
            <span style={{ display: "flex", gap: 8 }}>
              {page > 1 && <Link className="btn sm" href={href({ page: String(page - 1) })}>Previous</Link>}
              {page * PAGE < data.total && <Link className="btn sm" href={href({ page: String(page + 1) })}>Next</Link>}
            </span>
          </div>
        )}
      </section>

      {counted.length > 0 && (
        <section className="card">
          <div className="sech"><h2>Counted stock</h2><span className="muted" style={{ fontSize: 12.5 }}>Cables and items without serial numbers</span></div>
          <div className="tw">
            <table className="tbl">
              <thead><tr><th>Product</th><th className="num">In MRD Office</th><th className="num">At facilities</th><th className="num">With partners</th><th className="num">Minimum</th></tr></thead>
              <tbody>
                {counted.map((s) => (
                  <tr key={s.productId}>
                    <td>{s.name}<div className="muted" style={{ fontSize: 12 }}>{s.brand} {s.model}</div></td>
                    <td className="num" style={s.lowStock ? { color: "#A3201F", fontWeight: 600 } : undefined}>{s.inOffice}</td>
                    <td className="num">{s.atFacilities}</td>
                    <td className="num">{s.atPartners}</td>
                    <td className="num muted">{s.minStock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
