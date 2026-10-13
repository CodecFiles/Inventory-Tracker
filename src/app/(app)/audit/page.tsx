import Form from "next/form";
import Link from "next/link";
import { auditLog, type AuditRow } from "@/server/queries/places";
import { getPermissions, requireApprovedUser } from "@/server/session";

// Audit log (design/AuditLog.dc.html): every change, who made it, and what it was before.
// Written by the database itself (migration 0005) and insert-only — nobody can edit or delete it.

const TABLES = ["units", "stock_movements", "deployments", "deployment_items", "shipments", "shipment_items", "batches",
  "sim_assignments", "facilities", "products", "suppliers", "users", "user_permissions", "clients", "partners"];
const HIDE = new Set(["updated_at", "created_at"]);
const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

// "status: in_office → deployed" — only the fields that changed
function changes(r: AuditRow): string[] {
  if (r.before && r.after) {
    return Object.keys(r.after).filter((k) => !HIDE.has(k) && show(r.before![k]) !== show(r.after![k]))
      .map((k) => `${k}: ${show(r.before![k])} → ${show(r.after![k])}`);
  }
  const row = r.after ?? r.before ?? {};
  return Object.entries(row).filter(([k, v]) => !HIDE.has(k) && v !== null && k !== "id").slice(0, 6).map(([k, v]) => `${k}: ${show(v)}`);
}

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const user = await requireApprovedUser();
  const permissions = await getPermissions(user.id);
  if (!permissions.has("audit.view")) {
    return <main className="main"><div className="alert err">You do not have permission to view the audit log.</div></main>;
  }
  const sp = await searchParams;
  const entityType = one(sp.table);
  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);
  const rows = await auditLog(user.id, { entityType, limit: 100, offset: (page - 1) * 100 });
  const when = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Muscat" }).format(new Date(d));

  return (
    <main className="main">
      <div>
        <nav aria-label="Breadcrumb" className="bc"><Link href="/">Dashboard</Link><span aria-hidden="true">/</span><span>Audit log</span></nav>
        <h1 className="h1">Audit log</h1>
        <p className="muted">Every change, who made it and what it was before. Recorded by the database; it cannot be edited or deleted.</p>
      </div>
      <section className="card">
        <Form action="/audit" style={{ display: "flex", gap: 10, padding: "14px 18px", borderBottom: "1px solid #EEF1F4" }}>
          <select className="fld" name="table" defaultValue={entityType ?? ""} aria-label="What changed" style={{ width: 260 }}>
            <option value="">Everything</option>
            {TABLES.map((t) => <option key={t} value={t}>{t.replaceAll("_", " ")}</option>)}
          </select>
          <button className="btn" type="submit">Filter</button>
        </Form>
        {rows.length === 0 ? <div className="empty">No changes recorded.</div> : (
          <div className="tw">
            <table className="tbl">
              <thead><tr><th>When</th><th>Who</th><th>What</th><th>Changes</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="muted">{when(r.occurredAt)}</td>
                    <td>{r.actor ?? <span className="muted">system</span>}</td>
                    <td><span className="mono">{r.action.replace(".", " · ")}</span><span className="muted"> #{r.entityId}</span></td>
                    <td style={{ whiteSpace: "normal", fontSize: 12.5 }} className="mono">{changes(r).map((c, i) => <div key={i}>{c}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, padding: "12px 18px", borderTop: "1px solid #EEF1F4" }}>
          {page > 1 && <Link className="btn sm" href={`/audit?${new URLSearchParams({ ...(entityType ? { table: entityType } : {}), page: String(page - 1) })}`}>Newer</Link>}
          {rows.length === 100 && <Link className="btn sm" href={`/audit?${new URLSearchParams({ ...(entityType ? { table: entityType } : {}), page: String(page + 1) })}`}>Older</Link>}
        </div>
      </section>
    </main>
  );
}
