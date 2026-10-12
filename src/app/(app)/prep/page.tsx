import Form from "next/form";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { listUnits, pendingSerialLines } from "@/server/queries/inventory";
import { lookups } from "@/server/queries/places";
import { listFreeSims } from "@/server/inventory/prepare";
import { getPermissions, requireApprovedUser } from "@/server/session";
import { changeSim, configure, serialise } from "./actions";

// Device preparation (design/DevicePrep.dc.html), in MRD Office — or at a partner abroad, where MRD
// records the SIM and IP the partner used (A8). Counted items get their serial numbers here too.

export default async function PrepPage({ searchParams }: PageProps<"/prep">) {
  const user = await requireApprovedUser();
  const permissions = await getPermissions(user.id);
  if (!permissions.has("inventory.prepare")) {
    return <main className="main"><div className="alert err">You do not have permission to prepare devices.</div></main>;
  }
  const { partner } = await searchParams;
  const lists = await lookups(user.id);
  const atPartner = lists.partners.find((p) => String(p.id) === partner);

  const [withoutSim, withSim, sims, pending] = await Promise.all([
    atPartner ? listUnits(user.id, { locationId: atPartner.locationId, routerSim: "without", limit: 200 })
              : listUnits(user.id, { unconfiguredRouters: true, limit: 200 }),
    listUnits(user.id, { ...(atPartner ? { locationId: atPartner.locationId } : { place: "office" }), routerSim: "with", limit: 200 }),
    listFreeSims(user.id, atPartner ? { partnerId: atPartner.id } : {}),
    atPartner ? Promise.resolve([]) : pendingSerialLines(user.id),
  ]);
  const simOptions = sims.map((s) => <option key={s.unitId} value={s.unitId}>{s.iccid}{s.phoneNumber ? ` · ${s.phoneNumber}` : ""}{s.carrier ? ` · ${s.carrier}` : ""}</option>);
  const simSelect = (
    <label className="fl">SIM (ICCID)
      <select className="fld mono" name="simUnitId" required defaultValue="">
        <option value="" disabled>{sims.length ? "Choose a free SIM…" : "No free SIMs here"}</option>
        {simOptions}
      </select>
    </label>
  );
  const ipInput = <label className="fl">IP address (optional)<input className="fld mono" name="ipAddress" placeholder="10.64.12.37" /></label>;

  return (
    <main className="main">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <nav aria-label="Breadcrumb" className="bc"><Link href="/">Dashboard</Link><span aria-hidden="true">/</span><span>Device preparation</span></nav>
          <h1 className="h1">Device preparation</h1>
          <p className="muted">Put a SIM into each router and record its IP. {atPartner ? `Recording what ${atPartner.name} did in their stock.` : "In MRD Office."}</p>
        </div>
        <Form action="/prep" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <label className="fl">Where
            <select className="fld" name="partner" defaultValue={atPartner?.id ?? ""} style={{ width: 260 }}>
              <option value="">MRD Office</option>
              {lists.partners.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.country})</option>)}
            </select>
          </label>
          <button className="btn" type="submit">Show</button>
        </Form>
      </div>

      <section className="card">
        <div className="sh"><div><h2>Routers without a SIM</h2><p>{withoutSim.total} waiting · {sims.length} free SIMs {atPartner ? "at this partner" : "in the office"}</p></div></div>
        {withoutSim.rows.length === 0 ? <div className="empty">Every router here has a SIM.</div> : withoutSim.rows.map((r) => (
          <div key={r.unitId} className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
            <span style={{ flex: "1 1 200px" }}>
              <Link className="mono" href={`/inventory/${r.unitId}`} style={{ fontWeight: 500 }}>{r.serial}</Link>
              <div className="muted" style={{ fontSize: 12.5 }}>{r.product} · batch {r.batchCode}</div>
            </span>
            <ActionForm action={configure.bind(null, r.unitId)} submit="Put SIM in" className="formrow" style={{ flex: "3 1 480px" }}>
              {simSelect}{ipInput}
            </ActionForm>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="sh"><div><h2>Routers with a SIM</h2><p>Change a SIM if it fails or the router needs a new one. The old SIM becomes a spare, or is retired.</p></div></div>
        {withSim.rows.length === 0 ? <div className="empty">No routers with a SIM here.</div> : withSim.rows.map((r) => (
          <details key={r.unitId} className="edit row" style={{ display: "block" }}>
            <summary style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <Link className="mono" href={`/inventory/${r.unitId}`} style={{ fontWeight: 500 }}>{r.serial}</Link>
              <span className="muted" style={{ fontSize: 12.5 }}>{r.product}</span>
              <span className="mono muted" style={{ fontSize: 12.5, marginLeft: "auto" }}>{r.simIccid}{r.ipAddress ? ` · ${r.ipAddress}` : ""}</span>
              <span className="lnk">Change SIM</span>
            </summary>
            <ActionForm action={changeSim.bind(null, r.unitId)} submit="Change SIM" className="formrow" style={{ paddingTop: 12 }}>
              {simSelect}{ipInput}
              <label className="fl">The old SIM
                <select className="fld" name="oldSim" defaultValue="spare">
                  <option value="spare">Keep as a spare</option>
                  <option value="retire">Retire it (damaged / deactivated)</option>
                </select>
              </label>
            </ActionForm>
          </details>
        ))}
      </section>

      {!atPartner && (
        <section className="card">
          <div className="sh"><div><h2>Waiting for serial numbers</h2><p>Counted items (e.g. CO₂ sensors) get their serial numbers here, one per line.</p></div></div>
          {pending.length === 0 ? <div className="empty">Nothing is waiting for serial numbers.</div> : pending.map((l) => (
            <div key={l.batchLineId} className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
              <span style={{ flex: "1 1 200px" }}>
                <span style={{ fontWeight: 500 }}>{l.product}</span>
                <div className="muted" style={{ fontSize: 12.5 }}>batch <span className="mono">{l.batchCode}</span> · {l.serialised} of {l.received} done</div>
              </span>
              <ActionForm action={serialise.bind(null, l.batchLineId)} submit="Save serial numbers" className="formrow" style={{ flex: "3 1 480px" }}>
                <label className="fl">Serial numbers — one per line (up to {l.received - l.serialised})
                  <textarea className="fld mono" name="serials" rows={3} required />
                </label>
              </ActionForm>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
