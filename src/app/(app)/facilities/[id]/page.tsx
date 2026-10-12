import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { FacilityFields } from "@/components/facility-fields";
import { DocStatus, StageBadge, stageLabel, UnitStatus } from "@/components/status";
import { facilityDetail, lookups } from "@/server/queries/places";
import { getPermissions, requireApprovedUser } from "@/server/session";
import { addFacilityContact, changeStage, editFacility, removeFacilityContact, returnItems } from "../actions";

// One facility (design/FacilityDetail.dc.html): its stage, what is installed there, contacts,
// deployments — and returning items to MRD Office (Oman sites only; nothing returns from abroad, F10).

const STAGES = ["site_inspection", "bms_scan", "poc", "poc_study", "contract", "deployment", "active_operations", "closed"];
const day = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

export default async function FacilityPage({ params }: PageProps<"/facilities/[id]">) {
  const user = await requireApprovedUser();
  const { id } = await params;
  let f;
  try {
    f = await facilityDetail(user.id, { id: Number(id) });
  } catch {
    notFound();
  }
  const [permissions, lists] = await Promise.all([getPermissions(user.id), lookups(user.id)]);
  const can = (p: string) => permissions.has(p);
  const hasItems = f.installed.units.length > 0 || f.installed.counted.length > 0;
  const canReturn = can("inventory.move") && !f.abroad;
  const table = (
    <div className="tw">
      <table className="tbl">
        <thead><tr>{canReturn && <th />}<th>Serial</th><th>Product</th><th>SIM · IP</th><th>Placement</th><th>Status</th></tr></thead>
        <tbody>
          {f.installed.units.map((u) => (
            <tr key={u.unitId}>
              {canReturn && <td><input type="checkbox" name="unit" value={u.unitId} aria-label={`Return ${u.serial}`} /></td>}
              <td className="mono"><Link href={`/inventory/${u.unitId}`}>{u.serial}</Link></td>
              <td>{u.product}</td>
              <td className="mono muted">{u.simIccid ? `${u.simIccid}${u.ipAddress ? ` · ${u.ipAddress}` : ""}` : "—"}</td>
              <td className="muted">{[u.building, u.position].filter(Boolean).join(" · ") || "—"}</td>
              <td><UnitStatus status={u.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <main className="main">
      <nav aria-label="Breadcrumb" className="bc"><Link href="/facilities">Facilities</Link><span aria-hidden="true">/</span><span>{f.name}</span></nav>

      <section className="card" style={{ padding: "22px 24px", display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="ov">{f.client}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 className="h1">{f.name}</h1><StageBadge stage={f.stage} />
            {!f.isActive && <span className="b s-retired">Archived</span>}
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <span className="fact">{[f.city, f.country].filter(Boolean).join(", ")}</span>
            {f.partner && <span className="fact">Partner: {f.partner}</span>}
            {f.facilityType && <span className="fact">{f.facilityType}</span>}
          </div>
        </div>
        {can("deployments.create") && f.stage !== "closed" && f.isActive && (
          <div><Link className="btn p" href={`/deployments/new?facility=${f.id}`}>New deployment</Link></div>
        )}
      </section>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: "1.4 1 460px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="sh"><div><h2>Installed here</h2>
              <p>{f.installed.units.length} {f.installed.units.length === 1 ? "device" : "devices"}{f.installed.counted.length ? ` · ${f.installed.counted.map((c) => `${c.quantity} × ${c.product}`).join(", ")}` : ""}</p></div></div>
            {!hasItems ? <div className="empty">Nothing is installed here.</div> : canReturn ? (
              <ActionForm action={returnItems.bind(null, f.id)} submit="Return ticked items to MRD Office"
                          style={{ display: "flex", flexDirection: "column", alignItems: "stretch" }}
                          confirm="Return the ticked items to MRD Office?">
                {table}
                <div className="formrow" style={{ padding: "14px 18px", borderTop: "1px solid #EEF1F4" }}>
                  {f.installed.counted.map((c) => (
                    <label key={c.productId} className="fl">Return {c.product} (of {c.quantity})
                      <input className="fld" type="number" min={0} max={c.quantity} name={`qty_${c.productId}`} defaultValue={0} />
                    </label>
                  ))}
                  <label className="fl">Reason (optional)<input className="fld" name="note" placeholder="e.g. POC not converted" /></label>
                </div>
              </ActionForm>
            ) : (
              <>{table}{f.abroad && <p className="hint" style={{ padding: "0 18px 14px" }}>Items abroad are not returned to MRD Office (F10).</p>}</>
            )}
          </div>

          <div className="card">
            <div className="sh"><h2>Deployments</h2>
              {can("deployments.create") && f.stage !== "closed" && f.isActive && <Link className="btn sm" href={`/deployments/new?facility=${f.id}`}>New deployment</Link>}</div>
            {f.deployments.length === 0 ? <div className="empty">No deployments yet.</div> : f.deployments.map((d) => (
              <Link key={d.id} className="row" href={`/deployments/${d.id}`}>
                <span className="mono" style={{ fontWeight: 500 }}>{d.code}</span>
                <span className={d.type === "poc" ? "t t-poc" : "t t-con"}>{d.type === "poc" ? "POC" : "Contract"}</span>
                <span className="muted">{day(d.date)}</span>
                <span style={{ marginLeft: "auto" }}><DocStatus status={d.status} /></span>
              </Link>
            ))}
          </div>
        </div>

        <div style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="sh"><div><h2>Project stage</h2><p>Forward only; skipping a step needs a reason. Moving back or re-opening needs an Admin.</p></div></div>
            {can("facilities.change_stage") && (
              <div style={{ padding: "0 18px 14px" }}>
                <ActionForm action={changeStage.bind(null, f.id)} submit="Change stage" className="formrow">
                  <label className="fl">New stage
                    <select className="fld" name="toStage" required defaultValue={STAGES[STAGES.indexOf(f.stage) + 1] ?? "closed"}>
                      {STAGES.filter((s) => s !== f.stage).map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
                    </select>
                  </label>
                  <label className="fl">Reason (needed to skip or go back)<input className="fld" name="reason" /></label>
                </ActionForm>
              </div>
            )}
            {f.stageHistory.slice().reverse().map((h, i) => (
              <div key={i} className="kv" style={{ gridTemplateColumns: "110px 1fr" }}>
                <span className="k">{day(h.changedAt)}</span>
                <span>{h.from ? `${stageLabel(h.from)} → ` : ""}<strong>{stageLabel(h.to)}</strong>
                  <span className="muted"> · {h.by ?? "system"}</span>{h.note && <div className="muted" style={{ fontSize: 12.5 }}>“{h.note}”</div>}</span>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="sh"><h2>Contacts</h2></div>
            {f.contacts.length === 0 && <div className="empty" style={{ paddingTop: 0 }}>No contacts yet.</div>}
            {f.contacts.map((c) => (
              <div key={c.id} className="row" style={{ flexWrap: "wrap" }}>
                <span style={{ flex: 1 }}><span style={{ fontWeight: 500 }}>{c.name}</span>{c.isPrimary && <span className="b s-deployed" style={{ marginLeft: 8 }}>Primary</span>}
                  <div className="muted" style={{ fontSize: 12.5 }}>{[c.role, c.phone, c.email].filter(Boolean).join(" · ")}</div></span>
                {can("facilities.manage") && <ActionForm action={removeFacilityContact.bind(null, c.id)} submit="Remove" danger confirm={`Remove ${c.name}?`} />}
              </div>
            ))}
            {can("facilities.manage") && (
              <details className="edit" style={{ padding: "12px 18px", borderTop: "1px solid #EEF1F4" }}>
                <summary className="lnk">+ Add contact</summary>
                <ActionForm action={addFacilityContact.bind(null, f.id)} submit="Add contact" className="formrow" style={{ paddingTop: 10 }}>
                  <label className="fl">Name<input className="fld" name="name" required /></label>
                  <label className="fl">Role<input className="fld" name="role" /></label>
                  <label className="fl">Phone<input className="fld" name="phone" /></label>
                  <label className="fl">Email<input className="fld" name="email" type="email" /></label>
                  <label className="fl" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><input type="checkbox" name="isPrimary" /> Primary</label>
                </ActionForm>
              </details>
            )}
          </div>

          {can("facilities.manage") && (
            <details className="card edit">
              <summary style={{ padding: "14px 18px", fontWeight: 600 }}>Edit facility details</summary>
              <div style={{ padding: "0 18px 18px" }}>
                <ActionForm action={editFacility.bind(null, f.id)} submit="Save" className="formrow">
                  <FacilityFields f={f} clients={lists.clients} countries={lists.countries} partners={lists.partners} />
                </ActionForm>
              </div>
            </details>
          )}
        </div>
      </section>
    </main>
  );
}
