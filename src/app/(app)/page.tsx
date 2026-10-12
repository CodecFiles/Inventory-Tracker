import Link from "next/link";
import { DocStatus, StageBadge, stageLabel } from "@/components/status";
import { listDeployments } from "@/server/queries/documents";
import { dashboardSummary, listUnits, stockOverview } from "@/server/queries/inventory";
import { listFacilities } from "@/server/queries/places";
import { getPermissions, requireApprovedUser } from "@/server/session";

// Dashboard (design/Main.dc.html): the panels that real data supports today. The design's monthly
// charts arrive with Reports.

const STAGES = ["site_inspection", "bms_scan", "poc", "poc_study", "contract", "deployment", "active_operations", "closed"];
const STAGE_DOT: Record<string, string> = {
  site_inspection: "#8A96A8", bms_scan: "#1A8FAD", poc: "#7A52D1", poc_study: "#E08A00", contract: "#12A374",
  deployment: "#2F6FE4", active_operations: "#0B7A6B", closed: "#B9C2CE",
};

const today = () =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Muscat" }).format(new Date());

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Muscat" }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default async function Dashboard() {
  const user = await requireApprovedUser();
  const permissions = await getPermissions(user.id);
  const [summary, low, prep, deployments, facilities] = await Promise.all([
    dashboardSummary(user.id),
    stockOverview(user.id, { lowOnly: true }),
    listUnits(user.id, { unconfiguredRouters: true, limit: 5 }),
    listDeployments(user.id, { limit: 5 }),
    listFacilities(user.id, { limit: 5 }),
  ]);
  const w = summary.where;
  const other = w.total - w.office - w.facilities;
  const pct = (n: number) => (w.total ? `${(n / w.total) * 100}%` : "0%");

  const kpis = [
    { label: "Units tracked", value: w.total, sub: "serialised items in use", href: "/inventory", dot: "#0B7A6B" },
    { label: "In MRD Office", value: w.office, sub: "ready to prepare or deploy", href: "/inventory?place=office", dot: "#1A8FAD" },
    { label: "At facilities", value: w.facilities, sub: "deployed in Oman and abroad", href: "/inventory?place=facility", dot: "#12A374" },
    { label: "With partners", value: w.partners, sub: "shipped, not yet deployed", href: "/inventory?place=partner_stock", dot: "#3346A8" },
    { label: "In repair", value: w.repair, sub: "at repair companies or suppliers", href: "/inventory?status=in_repair", dot: "#E08A00" },
    { label: "Low-stock products", value: low.length, sub: "below their minimum level", href: "#low-stock", dot: "#DC3B3A" },
  ];
  if (permissions.has("users.approve") && summary.pendingUsers > 0) {
    kpis.push({ label: "Waiting for approval", value: summary.pendingUsers, sub: "new sign-ups", href: "/admin/users", dot: "#7A52D1" });
  }

  return (
    <main className="main">
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="muted" style={{ fontSize: 13 }}>{today()} · MRD Office, Muscat</span>
          <h1 className="h1">{greeting()}, {user.fullName.split(" ")[0]}</h1>
        </div>
      </div>

      <section aria-label="Inventory summary" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        {kpis.map((k) => (
          <Link key={k.label} className="card kpi" href={k.href}>
            <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="muted" style={{ fontSize: 13 }}>{k.label}</span>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: k.dot }} />
            </span>
            <span className="n">{k.value}</span>
            <span className="muted" style={{ fontSize: 12.5 }}>{k.sub}</span>
          </Link>
        ))}
      </section>

      <section className="card" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Where everything is</h2>
            <p className="muted" style={{ fontSize: 13 }}>Every tracked unit, from office stock to a live facility.</p>
          </div>
          <Link href="/inventory" style={{ fontSize: 13, fontWeight: 500 }}>Open inventory →</Link>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="seg" style={{ height: 12, borderRadius: 6, background: "#EEF1F4" }} role="img"
               aria-label={`${w.office} in MRD Office, ${w.facilities} at facilities, ${other} elsewhere`}>
            <span style={{ width: pct(w.office), background: "#1A8FAD" }} />
            <span style={{ width: pct(w.facilities), background: "#12A374" }} />
            <span style={{ width: pct(other), background: "#E08A00" }} />
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12.5, color: "#3B4758" }}>
            <span className="lg"><i style={{ background: "#1A8FAD" }} />In MRD Office <strong>{w.office}</strong></span>
            <span className="lg"><i style={{ background: "#12A374" }} />At facilities <strong>{w.facilities}</strong></span>
            <span className="lg"><i style={{ background: "#E08A00" }} />With partners · in repair <strong>{other}</strong></span>
          </div>
        </div>
      </section>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <div className="card" style={{ flex: "3 1 520px", minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 18px 14px" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Facility pipeline</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(70px, 1fr))", gap: 8, padding: "0 18px 16px" }}>
            {STAGES.map((s) => (
              <div key={s} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: "50%", background: STAGE_DOT[s] }} />
                <span style={{ fontSize: 20, fontWeight: 600 }}>{summary.stages[s] ?? 0}</span>
                <span className="muted" style={{ fontSize: 12, lineHeight: 1.25 }}>{stageLabel(s)}</span>
              </div>
            ))}
          </div>
          {facilities.length === 0 ? (
            <div className="empty">No facilities yet.</div>
          ) : (
            <div className="tw">
              <table className="tbl">
                <thead><tr><th>Facility</th><th>Stage</th><th>Devices</th></tr></thead>
                <tbody>
                  {facilities.map((f) => (
                    <tr key={f.id}>
                      <td><span style={{ fontWeight: 500 }}>{f.name}</span><div className="muted" style={{ fontSize: 12 }}>{f.client} · {f.city ?? f.country}</div></td>
                      <td><StageBadge stage={f.stage} /></td>
                      <td>{f.units}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card" style={{ flex: "2 1 320px", minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 18px 14px", gap: 8 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>Needs preparation</h2>
              <p className="muted" style={{ fontSize: 13 }}>{summary.routersWithoutSim} routers in the office without a SIM</p>
            </div>
          </div>
          {prep.rows.length === 0 ? (
            <div className="empty">Every router in the office has a SIM.</div>
          ) : (
            prep.rows.map((u) => (
              <Link key={u.unitId} className="row" href={`/inventory/${u.unitId}`}>
                <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <span className="mono" style={{ fontWeight: 500 }}>{u.serial}</span>
                  <span className="muted" style={{ fontSize: 12.5 }}>{u.product} · batch {u.batchCode}</span>
                </span>
                <span className="b s-unconf">No SIM</span>
              </Link>
            ))
          )}
        </div>
      </section>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <div className="card" style={{ flex: "3 1 520px", minWidth: 0 }}>
          <div style={{ padding: "18px 18px 14px" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Recent deployments</h2>
          </div>
          {deployments.length === 0 ? (
            <div className="empty">No deployments yet.</div>
          ) : (
            <div className="tw">
              <table className="tbl">
                <thead><tr><th>Ref</th><th>Date</th><th>Facility</th><th>Items</th><th>Type</th><th>Status</th><th>By</th></tr></thead>
                <tbody>
                  {deployments.map((d) => (
                    <tr key={d.id}>
                      <td className="mono">{d.code}</td>
                      <td className="muted">{d.date ? new Date(d.date).toISOString().slice(0, 10) : "—"}</td>
                      <td>{d.facility}<div className="muted" style={{ fontSize: 12 }}>{d.country}</div></td>
                      <td>{d.items}</td>
                      <td><span className={d.type === "poc" ? "t t-poc" : "t t-con"}>{d.type === "poc" ? "POC" : "Contract"}</span></td>
                      <td><DocStatus status={d.status} /></td>
                      <td className="muted">{d.createdBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card" id="low-stock" style={{ flex: "2 1 320px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "18px 18px 14px" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Low-stock alerts</h2>
            {low.length > 0 && <span className="b s-maint">{low.length}</span>}
          </div>
          {low.length === 0 ? (
            <div className="empty">Every product is at or above its minimum level.</div>
          ) : (
            low.map((p) => (
              <Link key={p.productId} className="row" href={`/inventory?productId=${p.productId}`}>
                <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 500 }}>{p.name}</span>
                  <span className="muted" style={{ fontSize: 12.5 }}>{p.brand} {p.model} · {p.category}</span>
                </span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                  <span style={{ fontWeight: 600, color: "#A3201F" }}>{p.inOffice}</span>
                  <span className="muted" style={{ fontSize: 12 }}>min {p.minStock}</span>
                </span>
              </Link>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
