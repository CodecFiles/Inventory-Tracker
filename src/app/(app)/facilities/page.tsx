import Form from "next/form";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { FacilityFields } from "@/components/facility-fields";
import { StageBadge, stageLabel } from "@/components/status";
import { listFacilities, lookups } from "@/server/queries/places";
import { getPermissions, requireApprovedUser } from "@/server/session";
import { addFacility } from "./actions";

// Facilities (design/Facilities.dc.html)
const STAGES = ["site_inspection", "bms_scan", "poc", "poc_study", "contract", "deployment", "active_operations", "closed"];
const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

export default async function FacilitiesPage({ searchParams }: PageProps<"/facilities">) {
  const user = await requireApprovedUser();
  const sp = await searchParams;
  const stage = one(sp.stage);
  const q = one(sp.q);
  const archived = one(sp.archived) === "1";
  const [permissions, facilities, lists] = await Promise.all([
    getPermissions(user.id),
    listFacilities(user.id, { stage, q, includeArchived: archived, limit: 200 }),
    lookups(user.id),
  ]);

  return (
    <main className="main">
      <div>
        <nav aria-label="Breadcrumb" className="bc"><Link href="/">Dashboard</Link><span aria-hidden="true">/</span><span>Facilities</span></nav>
        <h1 className="h1">Facilities</h1>
        <p className="muted">Client sites in Oman and abroad, and where each one is in the project lifecycle.</p>
      </div>

      {permissions.has("facilities.manage") && (
        <details className="card edit">
          <summary style={{ padding: "14px 18px", fontWeight: 600 }}>+ Add a facility</summary>
          <div style={{ padding: "0 18px 18px" }}>
            {lists.clients.length === 0 ? (
              <div className="alert warn">Add the client first in <Link href="/settings?tab=clients">Settings → Clients</Link>.</div>
            ) : (
              <ActionForm action={addFacility} submit="Add facility" className="formrow">
                <FacilityFields clients={lists.clients} countries={lists.countries} partners={lists.partners} />
              </ActionForm>
            )}
          </div>
        </details>
      )}

      <section className="card">
        <Form action="/facilities" style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "14px 18px", borderBottom: "1px solid #EEF1F4" }}>
          <input className="fld" name="q" defaultValue={q} placeholder="Facility or client…" aria-label="Search facilities" style={{ flex: "1 1 240px", width: "auto" }} />
          <select className="fld" name="stage" defaultValue={stage ?? ""} aria-label="Stage" style={{ flex: "0 1 220px", width: "auto" }}>
            <option value="">Every stage</option>
            {STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
          </select>
          <label className="fl" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="archived" value="1" defaultChecked={archived} /> Include archived
          </label>
          <button className="btn" type="submit">Filter</button>
        </Form>
        {facilities.length === 0 ? <div className="empty">No facilities found.</div> : (
          <div className="tw">
            <table className="tbl">
              <thead><tr><th>Facility</th><th>Client</th><th>Country</th><th>Partner</th><th>Stage</th><th className="num">Devices</th></tr></thead>
              <tbody>
                {facilities.map((f) => (
                  <tr key={f.id}>
                    <td><Link href={`/facilities/${f.id}`} style={{ fontWeight: 500 }}>{f.name}</Link>{!f.isActive && <span className="b s-retired" style={{ marginLeft: 8 }}>Archived</span>}
                      <div className="muted" style={{ fontSize: 12 }}>{f.city ?? ""}</div></td>
                    <td>{f.client}</td>
                    <td>{f.country}</td>
                    <td className="muted">{f.partner ?? "—"}</td>
                    <td><StageBadge stage={f.stage} /></td>
                    <td className="num">{f.units}</td>
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
