import Form from "next/form";
import Link from "next/link";
import { DocStatus } from "@/components/status";
import { listDeployments } from "@/server/queries/documents";
import { getPermissions, requireApprovedUser } from "@/server/session";

// Deployments (design/Deployments.dc.html)
const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);
const STATUSES = { draft: "Draft", scheduled: "Scheduled", completed: "Completed", cancelled: "Cancelled" };

export default async function DeploymentsPage({ searchParams }: PageProps<"/deployments">) {
  const user = await requireApprovedUser();
  const status = one((await searchParams).status);
  const [permissions, rows] = await Promise.all([getPermissions(user.id), listDeployments(user.id, { status, limit: 200 })]);
  return (
    <main className="main">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <nav aria-label="Breadcrumb" className="bc"><Link href="/">Dashboard</Link><span aria-hidden="true">/</span><span>Deployments</span></nav>
          <h1 className="h1">Deployments</h1>
          <p className="muted">Items sent to facilities. Stock only moves when a deployment is completed.</p>
        </div>
        {permissions.has("deployments.create") && <Link className="btn p" href="/deployments/new">New deployment</Link>}
      </div>
      <section className="card">
        <Form action="/deployments" style={{ display: "flex", gap: 10, padding: "14px 18px", borderBottom: "1px solid #EEF1F4" }}>
          <select className="fld" name="status" defaultValue={status ?? ""} aria-label="Status" style={{ width: 220 }}>
            <option value="">Every status</option>
            {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn" type="submit">Filter</button>
        </Form>
        {rows.length === 0 ? <div className="empty">No deployments yet.</div> : (
          <div className="tw">
            <table className="tbl">
              <thead><tr><th>Ref</th><th>Facility</th><th>Type</th><th>Date</th><th className="num">Items</th><th>Status</th><th>By</th></tr></thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="mono"><Link href={`/deployments/${d.id}`}>{d.code}</Link></td>
                    <td>{d.facility}<div className="muted" style={{ fontSize: 12 }}>{d.country}</div></td>
                    <td><span className={d.type === "poc" ? "t t-poc" : "t t-con"}>{d.type === "poc" ? "POC" : "Contract"}</span></td>
                    <td>{d.date ? new Date(d.date).toISOString().slice(0, 10) : "—"}</td>
                    <td className="num">{d.items}</td>
                    <td><DocStatus status={d.status} /></td>
                    <td className="muted">{d.createdBy}</td>
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
