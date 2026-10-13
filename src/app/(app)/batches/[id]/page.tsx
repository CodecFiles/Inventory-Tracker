import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { StateBar } from "@/components/batch-state";
import { Icon } from "@/components/icons";
import { UnitStatus } from "@/components/status";
import { batchFull } from "@/server/queries/batches";
import { getPermissions, requireApprovedUser } from "@/server/session";

// One delivery (design/BatchDetail.dc.html): where it came from and where its units are now, the
// units themselves, what happened to them and which deployments they went out on.
// Not built yet (no data behind them): editing a batch, printing labels, warranty, attached documents.

const TRACKING: Record<string, string> = { serialised: "Serialised", quantity: "Counted (quantity)", hybrid: "Counted, serial numbers added later" };
const FILTERS = [
  ["all", "All"], ["in_office", "In stock"], ["configured", "Ready"], ["deployed", "Deployed"], ["other", "Other"],
] as const;
const MOVE: Record<string, string> = {
  receive: "received", serialise: "added serial numbers for", deploy: "deployed", ship: "shipped",
  deploy_abroad: "deployed", return: "returned", send_repair: "sent for repair", back_from_repair: "brought back from repair",
  return_to_supplier: "returned to the supplier", write_off: "wrote off", correction: "corrected",
};

const muscat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Muscat" });
const day = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(d).replace("Sept", "Sep") : "—");
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

function Avatar({ name }: { name: string }) {
  return <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#E3F4F1", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 28px" }}>{initials(name)}</span>;
}

function ChainLink({ label, value, sub, href, current, pending }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; current?: boolean; pending?: boolean }) {
  const style = { display: "flex", flexDirection: "column" as const, gap: 2, padding: "10px 14px", borderRadius: 10, minWidth: 140, color: "#0E1726",
    border: current ? "2px solid #0B7A6B" : `1px ${pending ? "dashed" : "solid"} #E3E7EC` };
  const body = <>
    <span className="ov" style={{ fontSize: 11 }}>{label}</span>
    <span style={{ fontWeight: 500, fontSize: 13.5 }}>{value}</span>
    {sub && <span className="muted" style={{ fontSize: 12 }}>{sub}</span>}
  </>;
  return href ? <Link href={href} style={style}>{body}</Link> : <span style={style}>{body}</span>;
}

export default async function BatchPage({ params, searchParams }: PageProps<"/batches/[id]">) {
  const user = await requireApprovedUser();
  const { id } = await params;
  const sp = await searchParams;
  const filter = typeof sp.status === "string" && FILTERS.some(([k]) => k === sp.status) ? sp.status : "all";
  const [b, permissions] = await Promise.all([
    batchFull(user.id, { id: Number(id) }).catch(() => null),
    getPermissions(user.id),
  ]);
  if (!b) notFound();

  const s = {
    units: b.units.length,
    inStock: b.units.filter((u) => u.status === "in_office").length,
    ready: b.units.filter((u) => u.status === "configured").length,
    deployed: b.units.filter((u) => u.status === "deployed" || u.status === "deployed_abroad").length,
    partners: b.units.filter((u) => u.status === "shipped_to_partner").length,
    repair: b.units.filter((u) => u.status === "in_repair").length,
    gone: b.units.filter((u) => u.status === "retired" || u.status === "returned_to_supplier").length,
    available: b.units.filter((u) => u.place === "office" && (u.status === "in_office" || u.status === "configured")).length,
  };
  const received = b.lines.reduce((a, l) => a + l.quantityReceived, 0);
  const waitingForSerials = b.lines.filter((l) => l.tracking === "hybrid" && l.serialised < l.quantityReceived);
  const needSim = b.units.filter((u) => u.needsConfiguration && !u.simIccid && u.place === "office" && u.status === "in_office").length;
  const facilities = [...new Map(b.units.filter((u) => u.place === "facility").map((u) => [u.location, u.location])).values()];
  const deploymentIds = [...new Set(b.deployments.map((d) => d.deploymentId))];
  const pocCount = new Set(b.deployments.filter((d) => d.type === "poc").map((d) => d.deploymentId)).size;
  const status = s.units === 0 ? ["Counted stock", "s-stock"] : s.deployed === 0 ? ["In stock", "s-stock"]
    : s.deployed + s.gone >= s.units ? ["All deployed", "s-deployed"] : ["Partially deployed", "s-ready"];

  const shown = b.units.filter((u) => filter === "all" ? true
    : filter === "deployed" ? u.status === "deployed" || u.status === "deployed_abroad"
    : filter === "other" ? !["in_office", "configured", "deployed", "deployed_abroad"].includes(u.status)
    : u.status === filter);
  const filterCount = (k: string) => k === "all" ? s.units : k === "in_office" ? s.inStock : k === "configured" ? s.ready
    : k === "deployed" ? s.deployed : s.partners + s.repair + s.gone;
  const serials = b.units.map((u) => u.serial).sort();
  const products = b.lines.map((l) => l.product);

  const tiles = [
    { label: "Received", value: received, sub: day(b.receivedOn), dot: "#3B4758" },
    { label: "Available in office", value: s.available, sub: "in stock or ready", dot: "#1A8FAD" },
    { label: "In stock", value: s.inStock, sub: needSim ? `${needSim} need a SIM + IP` : "received, not prepared", dot: "#8A96A8" },
    { label: "Ready", value: s.ready, sub: "prepared, in the office", dot: "#2F6FE4" },
    { label: "Deployed", value: s.deployed, sub: `${facilities.length} ${facilities.length === 1 ? "facility" : "facilities"}`, dot: "#12A374" },
    { label: "In repair / out", value: s.repair + s.partners + s.gone, sub: `${s.repair} repair · ${s.partners} partners · ${s.gone} gone`, dot: "#E08A00" },
  ];

  return (
    <main className="main">
      <nav aria-label="Breadcrumb" className="bc"><Link href="/">Dashboard</Link><span aria-hidden="true">/</span><Link href="/batches">Batches</Link><span aria-hidden="true">/</span><span className="mono" style={{ color: "#0E1726" }}>{b.code}</span></nav>
      {sp.received && (
        <div role="status" className="alert ok">
          <span><strong>Batch <span className="mono">{b.code}</span> received.</strong> Everything below is now in MRD Office stock.
            {" "}<Link href="/prep">Prepare devices →</Link></span>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 className="h1 mono">{b.code}</h1>
            <span className={`b ${status[1]}`}>{status[0]}</span>
          </div>
          <p className="muted">
            <span style={{ color: "#0B7A6B" }}>{products[0]}</span>{products.length > 1 && ` + ${products.length - 1} more`} · {b.supplier} · received {day(b.receivedOn)} by {b.receivedBy}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {permissions.has("inventory.prepare") && (needSim > 0 || waitingForSerials.length > 0) && (
            <Link className="btn p" href="/prep"><Icon name="prep" size={16} />
              {needSim > 0 ? `Prepare ${needSim} ${needSim === 1 ? "device" : "devices"}` : "Add serial numbers"}
            </Link>
          )}
        </div>
      </div>

      <section className="card" aria-label="Traceability" style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <ChainLink label="Supplier" value={b.supplier} sub={`${b.supplierBatches} ${b.supplierBatches === 1 ? "batch" : "batches"} · ${b.supplierUnits} units`} href={`/batches?supplierId=${b.supplierId}`} />
        <span className="muted" aria-hidden="true">→</span>
        <ChainLink label="Batch" value={<span className="mono">{b.code}</span>} sub={b.purchaseOrder ?? (b.invoiceNumber ? `Invoice ${b.invoiceNumber}` : undefined)} current />
        <span className="muted" aria-hidden="true">→</span>
        <ChainLink label="Devices" value={`${received} × ${products[0]}${products.length > 1 ? ` + ${products.length - 1}` : ""}`}
                   sub={b.units.some((u) => u.needsConfiguration) ? `${b.units.filter((u) => u.simIccid).length} with SIM + IP` : `${s.units} with serial numbers`} />
        <span className="muted" aria-hidden="true">→</span>
        <ChainLink label="Facilities" value={facilities.length ? `${facilities.length} ${facilities.length === 1 ? "facility" : "facilities"}` : "None yet"}
                   sub={facilities.slice(0, 3).join(" · ") || "not deployed"} pending={!facilities.length} />
        <span className="muted" aria-hidden="true">→</span>
        <ChainLink label="Deployments" value={deploymentIds.length ? `${deploymentIds.length} ${deploymentIds.length === 1 ? "deployment" : "deployments"}` : "None yet"}
                   sub={deploymentIds.length ? `${pocCount} POC · ${deploymentIds.length - pocCount} contract` : undefined} pending={!deploymentIds.length} />
      </section>

      {s.units > 0 && (
        <section className="card" style={{ overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            {tiles.map((t) => (
              <div key={t.label} className="ans">
                <span className="q" style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: t.dot }} />{t.label}</span>
                <span style={{ fontSize: 22, fontWeight: 600 }}>{t.value}</span>
                <span className="muted" style={{ fontSize: 12 }}>{t.sub}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: "14px 18px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <StateBar s={s} height={10} />
            <span className="muted" style={{ fontSize: 12.5 }}>
              In stock <strong style={{ color: "#0E1726" }}>{s.inStock}</strong> · {pct(s.inStock, s.units)}% &nbsp;·&nbsp;
              Ready <strong style={{ color: "#0E1726" }}>{s.ready}</strong> · {pct(s.ready, s.units)}% &nbsp;·&nbsp;
              Deployed <strong style={{ color: "#0E1726" }}>{s.deployed}</strong> · {pct(s.deployed, s.units)}%
            </span>
          </div>
        </section>
      )}

      {waitingForSerials.length > 0 && (
        <div className="alert warn">
          {waitingForSerials.map((l) => `${l.quantityReceived - l.serialised} × ${l.product}`).join(", ")} still need serial numbers — add them in <Link href="/prep">Device preparation</Link>.
        </div>
      )}

      <section style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div className="card" style={{ flex: "2 1 520px", minWidth: 0 }}>
          <div className="hd" style={{ flexWrap: "wrap" }}>
            <div>
              <h2>{s.units > 0 ? "Units in this batch" : "What arrived"}</h2>
              {s.units > 0 && <p className="muted" style={{ fontSize: 13 }}>Serials {serials[0]} – {serials[serials.length - 1]} · showing {shown.length} of {s.units}</p>}
            </div>
          </div>
          {s.units > 0 ? (
            <>
              <div style={{ padding: "0 18px 12px" }}>
                <div className="cg" style={{ display: "inline-flex" }}>
                  {FILTERS.map(([k, label]) => (
                    <Link key={k} className={filter === k ? "chip on" : "chip"} href={k === "all" ? `/batches/${b.id}` : `/batches/${b.id}?status=${k}`}>
                      {label}<span className="cn">{filterCount(k)}</span>
                    </Link>
                  ))}
                </div>
              </div>
              <div className="tw">
                <table className="tbl">
                  <thead><tr><th>Serial / ICCID</th><th>Product</th><th>IMEI</th><th>Status</th><th>{b.units.some((u) => u.isSim) ? "Router / SIM" : "SIM ICCID"}</th><th>IP address</th><th>Where</th></tr></thead>
                  <tbody>
                    {shown.map((u) => (
                      <tr key={u.unitId}>
                        <td className="mono"><Link href={`/inventory/${u.unitId}`}>{u.serial}</Link></td>
                        <td>{u.product}</td>
                        <td className="mono muted">{u.imei ?? "—"}</td>
                        <td><UnitStatus status={u.status} /></td>
                        <td className="mono muted">{u.simIccid ?? (u.inRouter ? `in ${u.inRouter}` : "—")}</td>
                        <td className="mono muted">{u.ipAddress ?? "—"}</td>
                        <td>{u.location}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="tw">
              <table className="tbl">
                <thead><tr><th>Product</th><th className="num">Received</th><th>Tracking</th></tr></thead>
                <tbody>
                  {b.lines.map((l) => (
                    <tr key={l.id}><td>{l.product}<div className="muted" style={{ fontSize: 12 }}>{l.category}</div></td><td className="num">{l.quantityReceived}</td><td className="muted">{TRACKING[l.tracking]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="hd"><h2>Batch information</h2></div>
            <div className="kv"><span className="k">Supplier</span><span>{b.supplier}</span></div>
            <div className="kv"><span className="k">{b.lines.length > 1 ? "Products" : "Product"}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {b.lines.map((l) => (
                  <span key={l.id}><Link href={`/inventory?productId=${l.productId}`}>{l.product}</Link> × {l.quantityReceived}
                    <span className="muted" style={{ display: "block", fontSize: 12 }}>
                      {TRACKING[l.tracking]}{l.needsConfiguration ? " · needs a SIM + IP" : ""}{l.tracking === "hybrid" ? ` · ${l.serialised} of ${l.quantityReceived} serialised` : ""}
                    </span>
                  </span>
                ))}
              </span>
            </div>
            <div className="kv"><span className="k">Purchase order</span><span className="mono">{b.purchaseOrder ?? "—"}</span></div>
            <div className="kv"><span className="k">Invoice</span><span className="mono">{b.invoiceNumber ?? "—"}</span></div>
            <div className="kv"><span className="k">Received by</span><span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Avatar name={b.receivedBy} />{b.receivedBy}</span></div>
            <div className="kv"><span className="k">Received</span><span>{day(b.receivedOn)}</span></div>
            <div className="kv"><span className="k">Received into</span><span>MRD Office</span></div>
            {b.notes && <div style={{ padding: "10px 18px 16px", borderTop: "1px solid #EEF1F4" }}>
              <span className="ov" style={{ fontSize: 11 }}>Notes</span>
              <p style={{ marginTop: 6, padding: "10px 12px", borderRadius: 8, background: "#F8FAFB", fontSize: 13, whiteSpace: "pre-line" }}>{b.notes}</p>
            </div>}
          </div>

          <div className="card">
            <div className="hd"><h2>Batch activity</h2>{permissions.has("audit.view") && <Link href="/audit" style={{ fontSize: 13, fontWeight: 500 }}>Audit log →</Link>}</div>
            <div style={{ padding: "0 18px 14px", display: "flex", flexDirection: "column" }}>
              {b.activity.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Nothing yet.</p>}
              {b.activity.map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "8px 0" }}>
                  <Avatar name={a.who} />
                  <span style={{ fontSize: 13, lineHeight: 1.4 }}>
                    <strong style={{ fontWeight: 600 }}>{a.who}</strong> {MOVE[a.type] ?? a.type} {a.quantity > 1 ? `${a.quantity} × ` : ""}{a.product}
                    {a.place && <> {a.type === "receive" ? "into" : "·"} <span style={{ color: "#0B7A6B" }}>{a.place}</span></>}
                    {a.document && <> · <span className="mono">{a.document}</span></>}
                    <span className="muted" style={{ display: "block", fontSize: 12 }}>{muscat.format(a.at).replace("Sept", "Sep")}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="hd">
          <div><h2>Deployment history</h2><p className="muted" style={{ fontSize: 13 }}>Units from this batch that went out on a deployment</p></div>
          {permissions.has("deployments.create") && s.ready > 0 && <Link className="btn sm" href="/deployments/new">Deploy ready units ({s.ready})</Link>}
        </div>
        {b.deployments.length === 0 ? <div className="empty">No unit from this batch has been deployed yet.</div> : (
          <div className="tw">
            <table className="tbl">
              <thead><tr><th>Ref</th><th>Date</th><th>Facility</th><th>Device</th><th>SIM · IP</th><th>Type</th><th>Completed by</th></tr></thead>
              <tbody>
                {b.deployments.map((d, i) => (
                  <tr key={`${d.deploymentId}-${d.unitId}-${i}`}>
                    <td className="mono"><Link href={`/deployments/${d.deploymentId}`}>{d.code}</Link></td>
                    <td>{day(d.date)}</td>
                    <td><Link href={`/facilities/${d.facilityId}`} style={{ color: "#0E1726" }}>{d.facility}</Link>{d.place && <div className="muted" style={{ fontSize: 12 }}>{d.place}</div>}</td>
                    <td className="mono"><Link href={`/inventory/${d.unitId}`}>{d.serial}</Link></td>
                    <td className="mono muted">{d.simIccid ? `…${d.simIccid.slice(-7)}` : "—"}{d.ipAddress ? ` · ${d.ipAddress}` : ""}</td>
                    <td><span className={d.type === "poc" ? "t t-poc" : "t t-con"}>{d.type === "poc" ? "POC" : "Contract"}</span></td>
                    <td className="muted">{d.by ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
