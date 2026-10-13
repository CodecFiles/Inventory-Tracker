import Form from "next/form";
import Link from "next/link";
import { AutoSubmitSelect } from "@/components/auto-submit";
import { UNIT_DOT, UNIT_STATUSES, UnitStatus } from "@/components/status";
import { listBatches } from "@/server/queries/documents";
import { categoryCounts, listUnits, stockOverview, unitStatusCounts, type StockRow, type UnitRow } from "@/server/queries/inventory";
import { lookups } from "@/server/queries/places";
import { getPermissions, requireApprovedUser } from "@/server/session";

// All inventory (design/Inventory.dc.html). Filters live in the address (?status=…&categoryId=…),
// so a filtered list can be bookmarked or shared.
//
// Left out on purpose: the design's bulk actions (assign, move, change status for ticked rows) —
// items move only through deployments, shipments and the item page, where the rules are checked —
// and the column chooser / grid view, export and CSV import (they come with Reports and later).

const SIZES = [25, 50, 100];
const PLACES: Record<string, string> = {
  office: "MRD Office", facility: "At a facility", partner_stock: "With a partner",
  repair_company: "Repair company", supplier: "At supplier",
};
const SORTS: Record<string, string> = { product: "Product A–Z", newest: "Newest received", oldest: "Oldest received" };
const TRACKING: Record<string, string> = { serialised: "Serialised", quantity: "Quantity", hybrid: "Hybrid" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);
const id = (v: string | string[] | undefined) => (one(v) && Number(one(v)) > 0 ? Number(one(v)) : undefined);
const fmt = (n: number) => n.toLocaleString("en-GB");

// The second line under a serial: what is inside it, or what it is inside.
function identSub(u: UnitRow) {
  if (u.simIccid) return `SIM ${u.simIccid}${u.ipAddress ? ` · IP ${u.ipAddress}` : ""}`;
  if (u.inRouter) return `in router ${u.inRouter}`;
  if (u.imei) return `IMEI ${u.imei}`;
  if (u.phoneNumber) return `+${u.phoneNumber}`;
  return "";
}

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const user = await requireApprovedUser();
  const sp = (await searchParams) as Params;
  const productId = id(sp.productId);
  const categoryId = id(sp.categoryId);
  const batchId = id(sp.batchId);
  const status = one(sp.status);
  const place = one(sp.place);
  const q = one(sp.q);
  const sort = one(sp.sort) && one(sp.sort)! in SORTS ? one(sp.sort)! : "product";
  const size = SIZES.includes(Number(one(sp.size))) ? Number(one(sp.size)) : 50;
  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);

  const [permissions, data, counts, stock, lists, cats, batches] = await Promise.all([
    getPermissions(user.id),
    listUnits(user.id, { productId, categoryId, batchId, status, place, q, sort, limit: size, offset: (page - 1) * size }),
    unitStatusCounts(user.id, { productId, categoryId }),
    stockOverview(user.id),
    lookups(user.id),
    categoryCounts(user.id),
    listBatches(user.id, { limit: 200 }),
  ]);

  // counted pieces (no serial numbers) are listed with the units on the first page, unless a filter
  // only units can have is set
  const qLower = q?.toLowerCase();
  const counted: StockRow[] = stock.filter((s) => s.piecesInOffice + s.piecesElsewhere > 0
    && (!productId || s.productId === productId) && (!categoryId || s.categoryId === categoryId)
    && (!status || status === "in_office") && (!place || place === "office") && !batchId
    && (!qLower || `${s.name} ${s.brand} ${s.model}`.toLowerCase().includes(qLower)));
  const showCounted = page === 1 ? counted : [];

  const unitTotal = Object.values(counts).reduce((a, n) => a + n, 0);
  const allUnits = cats.reduce((a, c) => a + c.units, 0);
  const allPieces = cats.reduce((a, c) => a + c.pieces, 0);
  const pages = Math.max(1, Math.ceil(data.total / size));

  // keeps the other filters when one changes
  const current: Params = { productId: one(sp.productId), categoryId: one(sp.categoryId), batchId: one(sp.batchId), status, place, q,
                            sort: sort === "product" ? undefined : sort, size: size === 50 ? undefined : String(size) };
  const href = (change: Params) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...current, ...change })) if (typeof v === "string" && v !== "") next.set(k, v);
    const s = next.toString();
    return s ? `/inventory?${s}` : "/inventory";
  };
  const hidden = (keep: string[]) => keep.map((k) => typeof current[k] === "string"
    ? <input key={k} type="hidden" name={k} value={current[k] as string} /> : null);
  const anyFilter = q || productId || place || status || batchId || categoryId;

  return (
    <main className="main">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <nav aria-label="Breadcrumb" className="bc"><Link href="/">Dashboard</Link><span aria-hidden="true">/</span><span>Inventory</span><span aria-hidden="true">/</span><span style={{ color: "#0E1726" }}>All inventory</span></nav>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 className="h1">All inventory</h1>
            <p className="muted" style={{ marginTop: 4 }}>
              {fmt(allUnits + allPieces)} items across {lists.products.length} products · {fmt(allUnits)} serialised units, {fmt(allPieces)} quantity-tracked pieces
            </p>
          </div>
          {permissions.has("inventory.receive") && (
            <Link className="btn p" href="/receive">
              <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 17v3h16v-3" /></svg>
              Receive stock
            </Link>
          )}
        </div>
      </div>

      <section className="card" aria-label="Filter by status" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span className="ov">By status</span>
          <span className="muted" style={{ fontSize: 12 }}>Click a status to filter the list below</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className={status ? "fchip" : "fchip on"} href={href({ status: undefined, page: undefined })} aria-current={status ? undefined : "true"}>
            <i style={{ background: "#3B4758" }} />All units<strong>{fmt(unitTotal)}</strong>
          </Link>
          {UNIT_STATUSES.map(([key, label]) => (
            <Link key={key} className={status === key ? "fchip on" : "fchip"} href={href({ status: key, page: undefined })} aria-current={status === key ? "true" : undefined}>
              <i style={{ background: UNIT_DOT[key] }} />{label}<strong>{fmt(counts[key] ?? 0)}</strong>
            </Link>
          ))}
        </div>
      </section>

      <section className="card" style={{ minWidth: 0 }}>
        <div role="tablist" aria-label="Category" style={{ display: "flex", gap: 22, padding: "0 18px", borderBottom: "1px solid #E3E7EC", overflowX: "auto" }}>
          <Link role="tab" aria-selected={!categoryId} className={categoryId ? "ctab" : "ctab on"} href={href({ categoryId: undefined, productId: undefined, page: undefined })}>
            All<span className="n">{fmt(allUnits + allPieces)}</span>
          </Link>
          {cats.filter((c) => c.units + c.pieces > 0).map((c) => (
            <Link key={c.id} role="tab" aria-selected={categoryId === c.id} className={categoryId === c.id ? "ctab on" : "ctab"}
                  href={href({ categoryId: String(c.id), productId: undefined, page: undefined })}>
              {c.name}<span className="n">{fmt(c.units + c.pieces)}</span>
            </Link>
          ))}
        </div>

        <Form action="/inventory" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "14px 18px" }}>
          {hidden(["status", "categoryId", "size"])}
          <div style={{ position: "relative", flex: "1 1 280px", maxWidth: 380 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5E6B7D" strokeWidth="2" strokeLinecap="round" style={{ position: "absolute", left: 12, top: 12 }} aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input className="fld" type="search" name="q" defaultValue={q} placeholder="Filter by product, serial, batch, place…"
                   aria-label="Search inventory" style={{ paddingLeft: 36 }} />
          </div>
          <AutoSubmitSelect className={productId ? "ddsel act" : "ddsel"} name="productId" defaultValue={productId ?? ""} aria-label="Product">
            <option value="">Product: all</option>
            {lists.products.filter((p) => !categoryId || p.categoryId === categoryId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </AutoSubmitSelect>
          <AutoSubmitSelect className={place ? "ddsel act" : "ddsel"} name="place" defaultValue={place ?? ""} aria-label="Location">
            <option value="">Location: anywhere</option>
            {Object.entries(PLACES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </AutoSubmitSelect>
          <AutoSubmitSelect className={batchId ? "ddsel act" : "ddsel"} name="batchId" defaultValue={batchId ?? ""} aria-label="Batch">
            <option value="">Batch: all</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
          </AutoSubmitSelect>
          <AutoSubmitSelect className="ddsel" name="sort" defaultValue={sort} aria-label="Sort">
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>Sort: {v}</option>)}
          </AutoSubmitSelect>
          <button type="submit" className="btn">Filter</button>
          {anyFilter && <Link className="btn" href="/inventory" style={{ border: 0 }}>Clear all</Link>}
        </Form>

        {data.rows.length === 0 && showCounted.length === 0 ? (
          <div className="empty" style={{ borderTop: "1px solid #E3E7EC" }}>
            {allUnits + allPieces === 0 ? "Nothing in inventory yet — receive a delivery to add some." : "No items match these filters."}
          </div>
        ) : (
          <div className="tw" style={{ borderTop: "1px solid #E3E7EC" }}>
            <table className="tbl">
              <thead><tr><th>Product</th><th>Brand / model</th><th>Batch</th><th>Serial / qty</th><th>Status</th><th>Location</th><th>Received</th></tr></thead>
              <tbody>
                {showCounted.map((s) => (
                  <tr key={`p${s.productId}`}>
                    <td><Link href={href({ productId: String(s.productId), categoryId: undefined, page: undefined })} style={{ color: "#0E1726", fontWeight: 500 }}>{s.name}</Link>
                      <div className="muted" style={{ fontSize: 12 }}>{s.category} · {TRACKING[s.tracking]}</div></td>
                    <td><span>{s.brand}</span><div className="muted" style={{ fontSize: 12 }}>{s.model}</div></td>
                    <td className="muted">—</td>
                    <td><span className="mono" style={{ fontWeight: 500 }}>{fmt(s.piecesInOffice)} pcs</span>{s.lowStock && <span className="low">Low</span>}
                      <div className="muted mono" style={{ fontSize: 11.5 }}>min {s.minStock}{s.piecesElsewhere ? ` · ${fmt(s.piecesElsewhere)} out` : ""}{s.tracking === "hybrid" ? " · not yet serialised" : ""}</div></td>
                    <td><span className="b s-stock">In stock</span></td>
                    <td>MRD Office<div className="muted" style={{ fontSize: 12 }}>counted stock</div></td>
                    <td className="muted">—</td>
                  </tr>
                ))}
                {data.rows.map((u) => (
                  <tr key={u.unitId}>
                    <td><Link href={href({ productId: String(u.productId), categoryId: undefined, page: undefined })} style={{ color: "#0E1726", fontWeight: 500 }}>{u.product}</Link>
                      <div className="muted" style={{ fontSize: 12 }}>{u.category} · {TRACKING[u.tracking]}</div></td>
                    <td><span>{u.brand}</span><div className="muted" style={{ fontSize: 12 }}>{u.model}</div></td>
                    <td><Link className="mono" href={`/batches/${u.batchId}`}>{u.batchCode}</Link></td>
                    <td><Link className="mono" href={`/inventory/${u.unitId}`} style={{ color: "#0E1726", fontWeight: 500 }}>{u.serial}</Link>
                      <div className="muted mono" style={{ fontSize: 11.5 }}>{identSub(u)}</div></td>
                    <td><UnitStatus status={u.status} /></td>
                    <td>{u.location}{u.place !== "office" && <div className="muted" style={{ fontSize: 12 }}>{PLACES[u.place]}</div>}</td>
                    <td className="muted">{new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(u.receivedOn).replace("Sept", "Sep")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "12px 18px", borderTop: "1px solid #E3E7EC", fontSize: 13 }}>
          <span className="muted">
            {data.total ? `Showing ${(page - 1) * size + 1}–${Math.min(page * size, data.total)} of ${fmt(data.total)} units` : "No matching units"}
            {showCounted.length > 0 && ` · plus ${showCounted.length} counted ${showCounted.length === 1 ? "product" : "products"}`}
          </span>
          <Form action="/inventory" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {hidden(["productId", "categoryId", "batchId", "status", "place", "q", "sort"])}
            <label htmlFor="inv-size" className="muted">Rows per page</label>
            <AutoSubmitSelect id="inv-size" className="sel-s" name="size" defaultValue={String(size)}>
              {SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </AutoSubmitSelect>
            <span style={{ width: 8 }} />
            <Link className={page > 1 ? "pg" : "pg off"} aria-label="Previous page" href={href({ page: String(page - 1) })}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            </Link>
            {Array.from({ length: pages }, (_, i) => i + 1)
              .filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 2)
              .map((n, i, arr) => (
                <span key={n} style={{ display: "contents" }}>
                  {i > 0 && n - arr[i - 1] > 1 && <span className="muted">…</span>}
                  <Link className={n === page ? "pg on" : "pg"} aria-current={n === page ? "page" : undefined} aria-label={`Page ${n}`}
                        href={href({ page: n === 1 ? undefined : String(n) })}>{n}</Link>
                </span>
              ))}
            <Link className={page < pages ? "pg" : "pg off"} aria-label="Next page" href={href({ page: String(page + 1) })}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
            </Link>
          </Form>
        </div>
      </section>
    </main>
  );
}
