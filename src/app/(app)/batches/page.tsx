import Form from "next/form";
import Link from "next/link";
import { AutoSubmitSelect } from "@/components/auto-submit";
import { STATE_PARTS, StateBar } from "@/components/batch-state";
import { batchList } from "@/server/queries/batches";
import { lookups } from "@/server/queries/places";
import { getPermissions, requireApprovedUser } from "@/server/session";

// Batches (design/Batches.dc.html): every delivery received, newest first, and where its units are
// today. Filters live in the address, like All inventory.
// Left out until the features exist: Export, numbering rules, batch audit trail.

const SIZE = 50;
const TRACKING: Record<string, string> = { serialised: "Serialised", quantity: "Quantity", hybrid: "Hybrid" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);
const id = (v: string | string[] | undefined) => (one(v) && Number(one(v)) > 0 ? Number(one(v)) : undefined);
const fmt = (n: number) => n.toLocaleString("en-GB");
const day = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(d).replace("Sept", "Sep");
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);


export default async function BatchesPage({ searchParams }: PageProps<"/batches">) {
  const user = await requireApprovedUser();
  const sp = (await searchParams) as Params;
  const q = one(sp.q);
  const supplierId = id(sp.supplierId);
  const categoryId = id(sp.categoryId);
  const from = one(sp.from);
  const to = one(sp.to);
  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);
  const [permissions, data, lists] = await Promise.all([
    getPermissions(user.id),
    batchList(user.id, { q, supplierId, categoryId, from, to, limit: SIZE, offset: (page - 1) * SIZE }),
    lookups(user.id),
  ]);
  const { rows, total, summary, categories } = data;

  const current: Params = { q, supplierId: one(sp.supplierId), categoryId: one(sp.categoryId), from, to };
  const href = (change: Params) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...current, ...change })) if (typeof v === "string" && v !== "") next.set(k, v);
    const s = next.toString();
    return s ? `/batches?${s}` : "/batches";
  };
  const anyFilter = q || supplierId || categoryId || from || to;

  const tiles = [
    { label: "Batches this quarter", value: fmt(summary.thisQuarter), sub: `${summary.lastQuarter} received last quarter`, dot: "#3B4758" },
    { label: "Units received", value: fmt(summary.received), sub: `${fmt(summary.units)} with serial numbers`, dot: "#1A8FAD" },
    { label: "Deployed from batches", value: `${pct(summary.deployed, summary.units)}%`, sub: `${summary.deployed} of ${summary.units} serialised units`, dot: "#12A374" },
    { label: "Open items", value: fmt(summary.noInvoice + summary.repair),
      sub: `${summary.noInvoice} without invoice · ${summary.repair} in repair${summary.repairBatches ? ` from ${summary.repairBatches} ${summary.repairBatches === 1 ? "batch" : "batches"}` : ""}`, dot: "#E86A1C" },
  ];

  return (
    <main className="main">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <nav aria-label="Breadcrumb" className="bc"><Link href="/">Dashboard</Link><span aria-hidden="true">/</span><span>Inventory</span><span aria-hidden="true">/</span><span style={{ color: "#0E1726" }}>Batches</span></nav>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 className="h1">Batches</h1>
            <p className="muted" style={{ marginTop: 4 }}>Every shipment received from a supplier, and where each unit from it is today.</p>
          </div>
          {permissions.has("inventory.receive") && (
            <Link className="btn p" href="/receive">
              <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 17v3h16v-3" /></svg>
              Receive new batch
            </Link>
          )}
        </div>
      </div>

      <section aria-label="Batch summary" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        {tiles.map((t) => (
          <div key={t.label} className="card kpi">
            <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="muted" style={{ fontSize: 13 }}>{t.label}</span>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.dot }} />
            </span>
            <span className="n">{t.value}</span>
            <span className="muted" style={{ fontSize: 12.5 }}>{t.sub}</span>
          </div>
        ))}
      </section>

      <section className="card" style={{ minWidth: 0 }}>
        <div style={{ padding: "16px 18px 0" }}>
          <div className="cg" style={{ alignSelf: "flex-start" }} aria-label="Category">
            <Link className={categoryId ? "chip" : "chip on"} href={href({ categoryId: undefined })}>
              All categories<span className="cn">{fmt(summary.batches)}</span>
            </Link>
            {categories.map((c) => (
              <Link key={c.id} className={categoryId === c.id ? "chip on" : "chip"} href={href({ categoryId: String(c.id) })}>
                {c.name}<span className="cn">{c.batches}</span>
              </Link>
            ))}
          </div>
        </div>

        <Form action="/batches" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", padding: "14px 18px" }}>
          {categoryId && <input type="hidden" name="categoryId" value={categoryId} />}
          <label className="fl" style={{ flex: "1 1 260px" }}>Search
            <input className="fld" type="search" name="q" defaultValue={q} placeholder="Batch code, product, PO or invoice" />
          </label>
          <label className="fl" style={{ flex: "0 1 220px" }}>Supplier
            <AutoSubmitSelect className="fld" name="supplierId" defaultValue={supplierId ?? ""}>
              <option value="">All suppliers</option>
              {lists.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </AutoSubmitSelect>
          </label>
          <label className="fl" style={{ flex: "0 1 160px" }}>Received from
            <input className="fld" type="date" name="from" defaultValue={from} />
          </label>
          <label className="fl" style={{ flex: "0 1 160px" }}>to
            <input className="fld" type="date" name="to" defaultValue={to} />
          </label>
          <button type="submit" className="btn">Filter</button>
          {anyFilter && <Link className="btn" href="/batches" style={{ border: 0 }}>Clear all</Link>}
        </Form>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "10px 18px", borderTop: "1px solid #EEF1F4", fontSize: 12.5 }}>
          <span className="muted">Showing <strong style={{ color: "#0E1726" }}>{rows.length}</strong> of {total} {total === 1 ? "batch" : "batches"}</span>
          <span style={{ display: "flex", gap: 14, flexWrap: "wrap", color: "#3B4758" }}>
            {STATE_PARTS.slice(0, 5).map(([k, label, color]) => <span key={k} className="lg"><i style={{ background: color }} />{label}</span>)}
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="empty" style={{ borderTop: "1px solid #E3E7EC" }}>{anyFilter ? "No batches match these filters." : "No deliveries received yet."}</div>
        ) : (
          <div className="tw">
            <table className="tbl">
              <thead><tr><th>Batch</th><th>Product</th><th>Supplier</th><th>Received</th><th>Received by</th><th className="num">Qty</th><th style={{ minWidth: 150 }}>Unit states</th><th className="num">Available</th></tr></thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td className="mono"><Link href={`/batches/${b.id}`}>{b.code}</Link></td>
                    <td>{b.product}{b.lines > 1 && <span className="muted"> + {b.lines - 1} more</span>}
                      <div className="muted" style={{ fontSize: 12 }}>{b.category} · {TRACKING[b.tracking] ?? b.tracking}</div></td>
                    <td>{b.supplier}</td>
                    <td>{day(b.receivedOn)}</td>
                    <td><span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#E3F4F1", fontSize: 10, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials(b.receivedBy)}</span>
                      {b.receivedBy.split(" ")[0]}</span></td>
                    <td className="num" style={{ fontWeight: 600 }}>{fmt(b.quantity)}{b.units === 0 ? " pcs" : ""}</td>
                    <td>{b.units > 0 ? <>
                      <StateBar s={b} />
                      <span className="muted" style={{ fontSize: 12 }}>{pct(b.deployed, b.units)}% deployed</span>
                    </> : <span className="muted" style={{ fontSize: 12 }}>counted stock</span>}</td>
                    <td className="num">{b.units > 0 ? b.available : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > SIZE && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 18px", borderTop: "1px solid #EEF1F4" }}>
            {page > 1 && <Link className="btn sm" href={href({ page: String(page - 1) })}>Previous</Link>}
            {page * SIZE < total && <Link className="btn sm" href={href({ page: String(page + 1) })}>Next</Link>}
          </div>
        )}
      </section>

      <section className="card" style={{ padding: "16px 18px", display: "flex", gap: 14, alignItems: "center" }}>
        <span style={{ width: 36, height: 36, borderRadius: 9, background: "#E6F4F1", color: "#0B7A6B", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 36px" }}>
          <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></svg>
        </span>
        <p style={{ fontSize: 13.5 }}><strong>Full traceability.</strong> <span className="muted">Every unit keeps its batch for life: Supplier → Batch → Device → SIM → IP → Facility → Deployment. Batch codes follow PREFIX-YEAR-NUMBER and are created automatically.</span></p>
      </section>
    </main>
  );
}
