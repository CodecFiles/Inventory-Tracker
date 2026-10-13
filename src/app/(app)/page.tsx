import Link from "next/link";
import { Icon } from "@/components/icons";
import { DocStatus, StageBadge, stageLabel } from "@/components/status";
import { dashboardPanels } from "@/server/queries/dashboard";
import { listDeployments } from "@/server/queries/documents";
import { dashboardSummary, listUnits, stockOverview } from "@/server/queries/inventory";
import { listFacilities } from "@/server/queries/places";
import { getPermissions, requireApprovedUser } from "@/server/session";

// Dashboard (design/Main.dc.html), every panel from real data. Left out until their features exist:
// the 7 days / 30 days / Quarter switch and Export (they come with Reports) and notifications.

const STAGES = ["site_inspection", "bms_scan", "poc", "poc_study", "contract", "deployment", "active_operations", "closed"];
const STAGE_DOT: Record<string, string> = {
  site_inspection: "#8A96A8", bms_scan: "#1A8FAD", poc: "#7A52D1", poc_study: "#E08A00", contract: "#12A374",
  deployment: "#2F6FE4", active_operations: "#0B7A6B", closed: "#B9C2CE",
};
const PART_COLOR = { inStock: "#1A8FAD", reserved: "#7C4DDB", deployed: "#12A374", partners: "#3346A8", repair: "#E86A1C" };
const PART_LABEL = { inStock: "In office", reserved: "Reserved", deployed: "At facilities", partners: "With partners", repair: "In repair" };
const AVATAR = ["#E3F4F1", "#E6F0FB", "#F1ECFD", "#FDF3E3", "#EAF6EF"];

// What each kind of stock move reads as in "Recent activity": the verb, and the word before the place.
const MOVE: Record<string, [string, string]> = {
  receive: ["received", "into"], serialise: ["added serial numbers for", "at"], deploy: ["deployed", "to"],
  ship: ["shipped", "to"], deploy_abroad: ["deployed", "to"], return: ["returned", "to"],
  send_repair: ["sent for repair", "to"], back_from_repair: ["brought back from repair", "to"],
  return_to_supplier: ["returned to the supplier", "·"], write_off: ["wrote off", "from"], correction: ["corrected", "at"],
};

const muscat = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Muscat", ...opts });
const today = () => muscat({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
// calendar dates (no time) arrive as midnight UTC, so they are shown in UTC to keep the same day
const day = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(d).replace("Sept", "Sep");
const shortDay = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short" }).format(d).replace("Sept", "Sep");
const when = (d: Date) => muscat({ weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);

function greeting() {
  const hour = Number(muscat({ hour: "numeric", hour12: false }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

const share = (n: number, of: number) => (of ? `${(n / of) * 100}%` : "0%");
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

function CardHead({ title, sub, link }: { title: string; sub?: string; link?: { href: string; label: string } }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "18px 18px 14px" }}>
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h2>
        {sub && <p className="muted" style={{ fontSize: 13 }}>{sub}</p>}
      </div>
      {link && <Link href={link.href} style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" }}>{link.label}</Link>}
    </div>
  );
}

export default async function Dashboard() {
  const user = await requireApprovedUser();
  const permissions = await getPermissions(user.id);
  const [summary, panels, low, prep, deployments, facilities] = await Promise.all([
    dashboardSummary(user.id),
    dashboardPanels(user.id),
    stockOverview(user.id, { lowOnly: true }),
    listUnits(user.id, { unconfiguredRouters: true, limit: 5 }),
    listDeployments(user.id, { limit: 5 }),
    listFacilities(user.id, { limit: 5 }),
  ]);
  const { life, categories, months, totals, batches, upcoming, activity } = panels;
  const w = summary.where;
  const other = w.total - w.office - w.facilities;
  const atFacilities = life.poc + life.contract;

  const kpis = [
    { label: "Total items", value: w.total + totals.counted, sub: `${w.total} serialised · ${totals.counted} by quantity`, href: "/inventory", dot: "#3B4758" },
    { label: "Products", value: totals.products, sub: `across ${totals.categories} categories`, href: "/settings?tab=products", dot: "#3B4758" },
    { label: "In office stock", value: w.office, sub: "MRD Office", href: "/inventory?place=office", dot: "#1A8FAD" },
    { label: "Ready for deployment", value: life.ready, sub: `${life.reserved} reserved for facilities`, href: "/inventory?status=configured", dot: "#2F6FE4" },
    { label: "Deployed", value: atFacilities, sub: `${life.poc} POC · ${life.contract} contract`, href: "/inventory?place=facility", dot: "#12A374" },
    { label: "With partners", value: w.partners, sub: "shipped, not yet deployed", href: "/inventory?place=partner_stock", dot: "#3346A8" },
    { label: "Under maintenance", value: w.repair, sub: "at repair companies or suppliers", href: "/inventory?status=in_repair", dot: "#E08A00" },
    { label: "Low-stock items", value: low.length, sub: "below minimum level", href: "#low-stock", dot: "#DC3B3A" },
  ];
  if (permissions.has("users.approve") && summary.pendingUsers > 0) {
    kpis.push({ label: "Waiting for approval", value: summary.pendingUsers, sub: "new sign-ups", href: "/admin/users", dot: "#7A52D1" });
  }

  const lifecycle = [
    { label: "Office stock", value: life.office, sub: "received, not prepared", href: "/inventory?place=office&status=in_office" },
    { label: "Ready", value: life.ready, sub: "configured, in the office", href: "/inventory?place=office&status=configured" },
    { label: "Reserved", value: life.reserved, sub: "on an open deployment or shipment", href: "/deployments" },
    { label: "With partners", value: life.partners, sub: "in partner stock abroad", href: "/inventory?place=partner_stock" },
    { label: "POC", value: life.poc, sub: `at ${life.pocFacilities} POC ${life.pocFacilities === 1 ? "facility" : "facilities"}`, href: "/facilities?stage=poc", tint: "#FAF7FF" },
    { label: "Contract", value: life.contract, sub: `at ${life.contractFacilities} contract ${life.contractFacilities === 1 ? "facility" : "facilities"}`, href: "/inventory?place=facility", tint: "#F4FBF8" },
  ];

  const maxCat = Math.max(1, ...categories.map((c) => c.total));
  const maxMonth = Math.max(1, ...months.flatMap((m) => [m.received, m.deployed]));
  const atFacilityCats = categories.filter((c) => c.poc + c.contract > 0);
  const maxFac = Math.max(1, ...atFacilityCats.map((c) => c.poc + c.contract));

  return (
    <main className="main">
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="muted" style={{ fontSize: 13 }}>{today()} · MRD Office, Muscat</span>
          <h1 className="h1">{greeting()}, {user.fullName.split(" ")[0]}</h1>
        </div>
      </div>

      <section aria-label="Inventory summary" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        {kpis.map((k) => (
          <Link key={k.label} className="card kpi" href={k.href}>
            <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="muted" style={{ fontSize: 13 }}>{k.label}</span>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: k.dot }} />
            </span>
            <span className="n">{k.value.toLocaleString("en-GB")}</span>
            <span className="muted" style={{ fontSize: 12.5 }}>{k.sub}</span>
          </Link>
        ))}
      </section>

      <section className="card" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Where everything is</h2>
            <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>Every unit, from office stock to a live facility. Click a stage to see its items.</p>
          </div>
          <Link href="/inventory" style={{ fontSize: 13, fontWeight: 500 }}>Open inventory →</Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          {lifecycle.map((s, i) => (
            <Link key={s.label} href={s.href}
                  style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14, borderRadius: 10, border: "1px solid #E3E7EC", background: s.tint ?? "#fff", color: "#0E1726" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 500, color: "#3B4758" }}>
                <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", border: "1px solid #D5DBE3", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>{i + 1}</span>
                {s.label}
              </span>
              <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em" }}>{s.value}</span>
              <span className="muted" style={{ fontSize: 12 }}>{s.sub}</span>
            </Link>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="seg" style={{ height: 12, borderRadius: 6, background: "#EEF1F4" }} role="img"
               aria-label={`${w.office} in MRD Office, ${w.facilities} at facilities, ${other} elsewhere`}>
            <span style={{ width: share(w.office, w.total), background: "#1A8FAD" }} />
            <span style={{ width: share(w.facilities, w.total), background: "#12A374" }} />
            <span style={{ width: share(other, w.total), background: "#E08A00" }} />
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12.5, color: "#3B4758" }}>
            <span className="lg"><i style={{ background: "#1A8FAD" }} />In MRD Office <strong>{w.office}</strong></span>
            <span className="lg"><i style={{ background: "#12A374" }} />At facilities <strong>{w.facilities}</strong></span>
            <span className="lg"><i style={{ background: "#E08A00" }} />With partners · in repair <strong>{other}</strong></span>
          </div>
        </div>
      </section>

      {categories.length > 0 && (
        <section aria-label="Devices by category" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          {categories.map((c) => {
            const parts = (Object.keys(PART_COLOR) as (keyof typeof PART_COLOR)[])
              .map((k) => ({ key: k, label: PART_LABEL[k], color: PART_COLOR[k], value: c[k] }))
              .filter((p) => p.value > 0);
            return (
              <Link key={c.categoryId} className="card" href={`/inventory?categoryId=${c.categoryId}`}
                    style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14, color: "#0E1726" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{c.category}</div>
                    <div className="muted" style={{ fontSize: 12.5 }}>{c.models}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1 }}>{c.total}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>total</div>
                  </div>
                </div>
                <div className="seg">
                  {parts.map((p) => <span key={p.key} style={{ width: share(p.value, c.total), background: p.color }} title={`${p.label} · ${p.value}`} />)}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "6px 14px" }}>
                  {parts.map((p) => (
                    <span key={p.key} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#3B4758" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />{p.label}
                      <strong style={{ marginLeft: "auto", color: "#0E1726", fontWeight: 600 }}>{p.value}</strong>
                    </span>
                  ))}
                </div>
              </Link>
            );
          })}
        </section>
      )}

      <section style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <div className="card" style={{ flex: "3 1 520px", minWidth: 0 }}>
          <CardHead title="Facility pipeline" sub={`${Object.values(summary.stages).reduce((a, b) => a + b, 0)} facilities across the MRD × Exergio lifecycle`}
                    link={{ href: "/facilities", label: "All facilities →" }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(70px, 1fr))", gap: 0, padding: "0 18px 16px" }}>
            {STAGES.map((s, i) => (
              <Link key={s} href={`/facilities?stage=${s}`} style={{ display: "flex", flexDirection: "column", gap: 8, color: "#0E1726" }}>
                <span style={{ display: "flex", alignItems: "center" }}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: STAGE_DOT[s], flex: "0 0 12px" }} />
                  {i < STAGES.length - 1 && <span style={{ flex: 1, height: 2, background: "#E3E7EC" }} />}
                </span>
                <span style={{ fontSize: 20, fontWeight: 600 }}>{summary.stages[s] ?? 0}</span>
                <span className="muted" style={{ fontSize: 12, lineHeight: 1.25, paddingRight: 8 }}>{stageLabel(s)}</span>
              </Link>
            ))}
          </div>
          {facilities.length === 0 ? (
            <div className="empty">No facilities yet.</div>
          ) : (
            <div className="tw">
              <table className="tbl">
                <thead><tr><th>Facility</th><th>Stage</th><th>Devices</th><th>Last deployment</th><th></th></tr></thead>
                <tbody>
                  {facilities.map((f) => (
                    <tr key={f.id}>
                      <td><Link href={`/facilities/${f.id}`} style={{ color: "#0E1726", fontWeight: 500 }}>{f.name}</Link><div className="muted" style={{ fontSize: 12 }}>{f.client} · {f.city ?? f.country}</div></td>
                      <td><StageBadge stage={f.stage} /></td>
                      <td>{f.units}</td>
                      <td className="muted">{f.lastDeployment ? day(f.lastDeployment) : "—"}</td>
                      <td style={{ textAlign: "right" }}><Link href={`/facilities/${f.id}`} aria-label={`Open ${f.name}`}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card" style={{ flex: "2 1 340px", minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 18px 14px", gap: 8 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>Needs preparation</h2>
              <p className="muted" style={{ fontSize: 13 }}>{summary.routersWithoutSim} routers in the office without a SIM</p>
            </div>
            {permissions.has("inventory.prepare") && <Link className="btn sm p" href="/prep">Start prep</Link>}
          </div>
          {prep.rows.length === 0 ? (
            <div className="empty">Every router in the office has a SIM.</div>
          ) : (
            prep.rows.map((u) => (
              <Link key={u.unitId} className="row" href={`/inventory/${u.unitId}`}>
                <span style={{ width: 36, height: 36, borderRadius: 9, background: "#F1F4F7", display: "flex", alignItems: "center", justifyContent: "center", color: "#3B4758", flex: "0 0 36px" }}>
                  <Icon name="router" size={18} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 500, fontSize: 13.5 }}>{u.product} · <span className="mono">{u.serial}</span></span>
                  <span className="muted" style={{ fontSize: 12 }}>{u.batchCode} · awaiting SIM</span>
                </span>
                <span className="b s-unconf">No SIM</span>
              </Link>
            ))
          )}
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Serialised assets by category</h2>
            <p className="muted" style={{ fontSize: 12.5 }}>{w.total} tracked units · plus {totals.counted.toLocaleString("en-GB")} quantity-tracked (cables, accessories)</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {categories.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Nothing received yet.</p>}
            {categories.map((c) => (
              <div key={c.categoryId} style={{ display: "grid", gridTemplateColumns: "120px 1fr 36px", alignItems: "center", gap: 10, fontSize: 12.5 }} title={`${c.category}: ${c.total} units`}>
                <span style={{ color: "#3B4758" }}>{c.category}</span>
                <span style={{ height: 10, background: "#F1F4F7", borderRadius: "0 4px 4px 0" }}>
                  <span style={{ display: "block", height: 10, width: share(c.total, maxCat), background: "#0E8A78", borderRadius: "0 4px 4px 0" }} />
                </span>
                <span style={{ textAlign: "right", fontWeight: 600 }}>{c.total}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Received vs deployed, monthly</h2>
            <p className="muted" style={{ fontSize: 12.5 }}>Serialised units · {months[0]?.month}–{months[months.length - 1]?.month}</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {([["Received", "received", "#0E8A78"], ["Deployed", "deployed", "#3B4758"]] as const).map(([label, key, color], i) => (
              <div key={key} style={{ display: "contents" }}>
                <span style={{ fontSize: 12, color: "#3B4758", marginTop: i ? 8 : 0 }}>{label}</span>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))`, gap: 6, alignItems: "end", height: 70, borderBottom: "1px solid #E3E7EC" }}>
                  {months.map((m) => (
                    <span key={m.month} title={`${m.month}: ${m[key]} ${key}`}
                          style={{ display: "block", height: m[key] ? `${Math.max(4, (m[key] / maxMonth) * 100)}%` : 0, background: color, borderRadius: "4px 4px 0 0" }} />
                  ))}
                </div>
              </div>
            ))}
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))`, gap: 6, fontSize: 11.5, color: "#5E6B7D", textAlign: "center" }}>
              {months.map((m) => <span key={m.month}>{m.month}</span>)}
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>POC vs contract equipment</h2>
            <p className="muted" style={{ fontSize: 12.5 }}>{atFacilities} serialised units at facilities</p>
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#3B4758" }}>
            <span className="lg"><i style={{ background: "#7A5AF8" }} />POC · {life.poc}</span>
            <span className="lg"><i style={{ background: "#0E8A78" }} />Contract · {life.contract}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {atFacilityCats.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Nothing at facilities yet.</p>}
            {atFacilityCats.map((c) => (
              <div key={c.categoryId} style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10, fontSize: 12.5 }}>
                <span style={{ color: "#3B4758" }}>{c.category}</span>
                <span style={{ display: "flex", gap: 2, height: 10 }} title={`${c.category}: ${c.poc} POC · ${c.contract} contract`}>
                  {c.poc > 0 && <span style={{ display: "block", width: share(c.poc, maxFac), background: "#7A5AF8" }} />}
                  {c.contract > 0 && <span style={{ display: "block", width: share(c.contract, maxFac), background: "#0E8A78", borderRadius: "0 4px 4px 0" }} />}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <div className="card" style={{ flex: "3 1 560px", minWidth: 0 }}>
          <CardHead title="Recent deployments" link={{ href: "/deployments", label: "Deployment history →" }} />
          {deployments.length === 0 ? (
            <div className="empty">No deployments yet.</div>
          ) : (
            <div className="tw">
              <table className="tbl">
                <thead><tr><th>Ref</th><th>Date</th><th>Facility</th><th>Items</th><th>Type</th><th>Status</th><th>By</th></tr></thead>
                <tbody>
                  {deployments.map((d) => (
                    <tr key={d.id}>
                      <td className="mono"><Link href={`/deployments/${d.id}`}>{d.code}</Link></td>
                      <td className="muted">{d.date ? shortDay(new Date(d.date)) : "—"}</td>
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C2560C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3l9.5 17H2.5z" /><path d="M12 10v4M12 17h.01" />
                </svg>
                <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 500, fontSize: 13.5 }}>{p.name}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{p.brand} {p.model} · {p.category}</span>
                </span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                  <span style={{ fontWeight: 600 }}>{p.inOffice}</span>
                  <span className="muted" style={{ fontSize: 11.5 }}>min {p.minStock}</span>
                </span>
              </Link>
            ))
          )}
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <div className="card">
          <CardHead title="Recently received" link={{ href: "/batches", label: "Batches →" }} />
          {batches.length === 0 && <div className="empty">No deliveries yet.</div>}
          {batches.map((b) => (
            <Link key={b.id} className="row" href={`/batches/${b.id}`}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="mono" style={{ display: "block", fontWeight: 500 }}>{b.code}</span>
                <span className="muted" style={{ fontSize: 12 }}>{b.product}{b.lines > 1 ? ` + ${b.lines - 1} more` : ""}</span>
              </span>
              <span style={{ textAlign: "right" }}>
                <span style={{ display: "block", fontWeight: 600 }}>{b.quantity} pcs</span>
                <span className="muted" style={{ fontSize: 11.5 }}>{shortDay(b.receivedOn)}</span>
              </span>
            </Link>
          ))}
        </div>

        <div className="card">
          <CardHead title="Upcoming" link={{ href: "/deployments", label: "Schedule →" }} />
          {upcoming.length === 0 && <div className="empty">No open deployments.</div>}
          {upcoming.map((u) => (
            <Link key={u.id} className="row" href={`/deployments/${u.id}`}>
              <span style={{ width: 44, flex: "0 0 44px", border: "1px solid #E3E7EC", borderRadius: 8, textAlign: "center", padding: "4px 0", lineHeight: 1.1 }}>
                <span style={{ display: "block", fontSize: 10.5, color: "#5E6B7D", textTransform: "uppercase" }}>
                  {u.date ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short" }).format(u.date) : "Date"}
                </span>
                <span style={{ display: "block", fontSize: 16, fontWeight: 600 }}>
                  {u.date ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit" }).format(u.date) : "—"}
                </span>
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 500, fontSize: 13.5 }}>{u.facility}</span>
                <span className="muted" style={{ fontSize: 12 }}>{u.code} · {u.items} {u.items === 1 ? "item" : "items"} · {u.status === "draft" ? "draft" : "scheduled"}</span>
              </span>
              <span className={u.type === "poc" ? "t t-poc" : "t t-con"}>{u.type === "poc" ? "POC" : "Contract"}</span>
            </Link>
          ))}
        </div>

        <div className="card">
          <CardHead title="Recent activity" link={permissions.has("audit.view") ? { href: "/audit", label: "Audit log →" } : undefined} />
          {activity.length === 0 && <div className="empty">Nothing has moved yet.</div>}
          <div style={{ padding: "4px 18px 18px", display: "flex", flexDirection: "column" }}>
            {activity.map((a, i) => {
              const [verb, prep] = MOVE[a.type] ?? [a.type, "·"];
              return (
                <div key={i} style={{ display: "flex", gap: 12, padding: "8px 0" }}>
                  <span style={{ width: 28, height: 28, borderRadius: "50%", background: AVATAR[i % AVATAR.length], fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 28px" }}>{initials(a.who)}</span>
                  <span style={{ fontSize: 13, lineHeight: 1.4 }}>
                    <strong style={{ fontWeight: 600 }}>{a.who}</strong> {verb} {a.quantity > 1 ? `${a.quantity} × ` : ""}{a.product}
                    {a.place && <> {prep} <span style={{ color: "#0B7A6B" }}>{a.place}</span></>}
                    {a.type === "receive" && a.batch && <> · <span className="mono">{a.batch}</span></>}
                    <span className="muted" style={{ display: "block", fontSize: 12 }}>{when(a.at)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
