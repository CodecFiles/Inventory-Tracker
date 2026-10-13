import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { DocStatus, StageBadge } from "@/components/status";
import { deploymentDetail } from "@/server/queries/documents";
import { availableUnits, countedStockAt } from "@/server/queries/inventory";
import { getPermissions, requireApprovedUser } from "@/server/session";
import { addCounted, addUnit, cancel, complete, removeItem, schedule } from "../actions";

// One deployment: add routers and items while it is a draft or scheduled, then complete it — every
// item (and each router's SIM) moves to the facility in one step, or nothing does.

const day = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

export default async function DeploymentPage({ params }: PageProps<"/deployments/[id]">) {
  const user = await requireApprovedUser();
  const { id } = await params;
  let d;
  try {
    d = await deploymentDetail(user.id, { id: Number(id) });
  } catch {
    notFound();
  }
  const permissions = await getPermissions(user.id);
  const open = d.status === "draft" || d.status === "scheduled";
  const canEdit = open && permissions.has("deployments.create");
  const [units, counted] = canEdit && d.sourceLocationId
    ? await Promise.all([availableUnits(user.id, { locationId: d.sourceLocationId }), countedStockAt(user.id, { locationId: d.sourceLocationId })])
    : [[], []];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date());
  const placement = (
    <>
      <label className="fl">Building (optional)<input className="fld" name="building" /></label>
      <label className="fl">Position (optional)<input className="fld" name="position" placeholder="e.g. Plant room" /></label>
    </>
  );

  return (
    <main className="main">
      <nav aria-label="Breadcrumb" className="bc"><Link href="/deployments">Deployments</Link><span aria-hidden="true">/</span><span className="mono">{d.code}</span></nav>

      <section className="card" style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="ov">{d.type === "poc" ? "POC deployment" : "Contract deployment"}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 className="h1 mono">{d.code}</h1><DocStatus status={d.status} />
        </div>
        <dl className="dl">
          <dt>Facility</dt><dd><Link href={`/facilities/${d.facilityId}`}>{d.facility}</Link> · {d.country} <StageBadge stage={d.facilityStage} /></dd>
          <dt>Items come from</dt><dd>{d.source ?? "—"}{d.abroad ? " (partner stock, abroad)" : ""}</dd>
          <dt>Date</dt><dd>{day(d.date)}</dd>
          <dt>Created by</dt><dd>{d.createdBy}</dd>
          {d.completedBy && <><dt>Completed by</dt><dd>{d.completedBy} · {day(d.completedAt)}</dd></>}
          {d.notes && <><dt>Notes</dt><dd>{d.notes}</dd></>}
        </dl>
      </section>

      <section className="card">
        <div className="sh"><div><h2>Items</h2><p>{d.items.length} lines{open ? " · nothing has moved yet" : ""}</p></div></div>
        {d.items.length === 0 ? <div className="empty">No items yet.</div> : (
          <div className="tw">
            <table className="tbl">
              <thead><tr><th>Product</th><th>Serial</th><th className="num">Qty</th><th>Placement</th>{canEdit && <th />}</tr></thead>
              <tbody>
                {d.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.product}</td>
                    <td className="mono">{i.unitId ? <Link href={`/inventory/${i.unitId}`}>{i.serial}</Link> : "—"}</td>
                    <td className="num">{i.quantity}</td>
                    <td className="muted">{[i.building, i.position].filter(Boolean).join(" · ") || "—"}{i.removedAt && d.status === "completed" ? " · since returned" : ""}</td>
                    {canEdit && <td><ActionForm action={removeItem.bind(null, i.id)} submit="Remove" danger /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canEdit && (
        <section style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div className="card" style={{ flex: "1 1 420px" }}>
            <div className="sh"><div><h2>Add a router or device</h2>
              <p>{d.abroad ? "From the partner's stock." : "From MRD Office. Routers need a SIM first (Device preparation)."}</p></div></div>
            <div style={{ padding: "0 18px 18px" }}>
              {units.length === 0 ? <div className="alert warn">Nothing available {d.abroad ? "in the partner's stock — ship items to the partner first" : "in MRD Office"}.</div> : (
                <ActionForm action={addUnit.bind(null, d.id)} submit="Add" className="formrow">
                  <label className="fl" style={{ flexBasis: "100%" }}>Item
                    <select className="fld mono" name="unitId" required defaultValue="">
                      <option value="" disabled>Choose…</option>
                      {units.map((u) => {
                        const blocked = !d.abroad && u.needsConfiguration && !u.simIccid;
                        return (
                          <option key={u.unitId} value={u.unitId} disabled={blocked}>
                            {u.serial} · {u.product}{u.simIccid ? ` · SIM ${u.simIccid}` : ""}{blocked ? " · needs a SIM first" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  {placement}
                </ActionForm>
              )}
            </div>
          </div>
          <div className="card" style={{ flex: "1 1 320px" }}>
            <div className="sh"><div><h2>Add counted items</h2><p>Cables and other items without serial numbers.</p></div></div>
            <div style={{ padding: "0 18px 18px" }}>
              {counted.length === 0 ? <div className="alert warn">No counted stock available here.</div> : (
                <ActionForm action={addCounted.bind(null, d.id)} submit="Add" className="formrow">
                  <label className="fl">Product
                    <select className="fld" name="productId" required defaultValue="">
                      <option value="" disabled>Choose…</option>
                      {counted.map((c) => <option key={c.productId} value={c.productId}>{c.product} ({c.quantity} available)</option>)}
                    </select>
                  </label>
                  <label className="fl">Quantity<input className="fld" type="number" name="quantity" min={1} required /></label>
                  {placement}
                </ActionForm>
              )}
            </div>
          </div>
        </section>
      )}

      {open && (permissions.has("deployments.create") || permissions.has("deployments.complete")) && (
        <section className="card">
          <div className="sh"><div><h2>Next step</h2><p>Completing moves every item — and each router&apos;s SIM — to {d.facility}, all at once.</p></div></div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", padding: "0 18px 18px", alignItems: "flex-end" }}>
            {permissions.has("deployments.complete") && (
              <ActionForm action={complete.bind(null, d.id)} submit="Complete deployment" className="formrow" style={{ flex: "1 1 320px" }}
                          confirm={`Complete ${d.code}? Every item moves to ${d.facility}.`}>
                <label className="fl">Installed on<input className="fld" type="date" name="date" defaultValue={today} max={today} /></label>
              </ActionForm>
            )}
            {permissions.has("deployments.create") && d.status === "draft" && (
              <ActionForm action={schedule.bind(null, d.id)} submit="Schedule" className="formrow" style={{ flex: "1 1 260px" }}>
                <label className="fl">Planned date<input className="fld" type="date" name="deploymentDate" required /></label>
              </ActionForm>
            )}
            {permissions.has("deployments.create") && (
              <ActionForm action={cancel.bind(null, d.id)} submit="Cancel deployment" danger confirm={`Cancel ${d.code}? Its items become free again.`} />
            )}
          </div>
        </section>
      )}
    </main>
  );
}
