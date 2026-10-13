import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { DocStatus } from "@/components/status";
import { shipmentDetail } from "@/server/queries/documents";
import { availableUnits, countedStockAt } from "@/server/queries/inventory";
import { getSql } from "@/server/db";
import { getPermissions, requireApprovedUser } from "@/server/session";
import { addCounted, addUnit, cancel, received, removeItem, ship } from "../actions";

// One shipment: add items while it is a draft, then ship it — everything (and each configured
// router's SIM) moves to the partner's stock at once. Unconfigured routers and loose SIMs may travel (R10).

const day = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

export default async function ShipmentPage({ params }: PageProps<"/shipments/[id]">) {
  const user = await requireApprovedUser();
  const { id } = await params;
  let s;
  try {
    s = await shipmentDetail(user.id, { id: Number(id) });
  } catch {
    notFound();
  }
  const permissions = await getPermissions(user.id);
  const canEdit = s.status === "draft" && permissions.has("shipments.manage");
  const [{ office }] = await getSql()<{ office: number }[]>`select office_location_id()::int as office`;
  const [units, counted] = canEdit
    ? await Promise.all([availableUnits(user.id, { locationId: office }), countedStockAt(user.id, { locationId: office })])
    : [[], []];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date());

  return (
    <main className="main">
      <nav aria-label="Breadcrumb" className="bc"><Link href="/shipments">Shipments</Link><span aria-hidden="true">/</span><span className="mono">{s.code}</span></nav>
      <section className="card" style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="ov">Shipment to a partner</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}><h1 className="h1 mono">{s.code}</h1><DocStatus status={s.status} /></div>
        <dl className="dl">
          <dt>Partner</dt><dd>{s.partner} · {s.country}</dd>
          <dt>Courier</dt><dd>{s.courier ?? "—"}</dd>
          <dt>Tracking</dt><dd className="mono">{s.trackingNumber ?? "—"}</dd>
          <dt>Shipped</dt><dd>{day(s.shippedOn)}{s.shippedBy ? ` · by ${s.shippedBy}` : ""}</dd>
          <dt>Created by</dt><dd>{s.createdBy}</dd>
        </dl>
      </section>

      <section className="card">
        <div className="sh"><h2>Items</h2></div>
        {s.items.length === 0 ? <div className="empty">No items yet.</div> : (
          <div className="tw">
            <table className="tbl">
              <thead><tr><th>Product</th><th>Serial</th><th className="num">Qty</th>{canEdit && <th />}</tr></thead>
              <tbody>
                {s.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.product}</td>
                    <td className="mono">{i.unitId ? <Link href={`/inventory/${i.unitId}`}>{i.serial}</Link> : "—"}</td>
                    <td className="num">{i.quantity}</td>
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
            <div className="sh"><div><h2>Add a router, SIM or device</h2><p>From MRD Office. A configured router takes its SIM along; loose SIMs can travel for the partner to fit.</p></div></div>
            <div style={{ padding: "0 18px 18px" }}>
              {units.length === 0 ? <div className="alert warn">Nothing available in MRD Office.</div> : (
                <ActionForm action={addUnit.bind(null, s.id)} submit="Add" className="formrow">
                  <label className="fl" style={{ flexBasis: "100%" }}>Item
                    <select className="fld mono" name="unitId" required defaultValue="">
                      <option value="" disabled>Choose…</option>
                      {units.map((u) => <option key={u.unitId} value={u.unitId}>{u.serial} · {u.product}{u.simIccid ? ` · SIM ${u.simIccid}` : u.needsConfiguration ? " · no SIM" : ""}</option>)}
                    </select>
                  </label>
                </ActionForm>
              )}
            </div>
          </div>
          <div className="card" style={{ flex: "1 1 320px" }}>
            <div className="sh"><div><h2>Add counted items</h2></div></div>
            <div style={{ padding: "0 18px 18px" }}>
              {counted.length === 0 ? <div className="alert warn">No counted stock in MRD Office.</div> : (
                <ActionForm action={addCounted.bind(null, s.id)} submit="Add" className="formrow">
                  <label className="fl">Product
                    <select className="fld" name="productId" required defaultValue="">
                      <option value="" disabled>Choose…</option>
                      {counted.map((c) => <option key={c.productId} value={c.productId}>{c.product} ({c.quantity} available)</option>)}
                    </select>
                  </label>
                  <label className="fl">Quantity<input className="fld" type="number" name="quantity" min={1} required /></label>
                </ActionForm>
              )}
            </div>
          </div>
        </section>
      )}

      {permissions.has("shipments.manage") && (s.status === "draft" || s.status === "shipped") && (
        <section className="card">
          <div className="sh"><h2>Next step</h2></div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", padding: "0 18px 18px", alignItems: "flex-end" }}>
            {s.status === "draft" && (
              <>
                <ActionForm action={ship.bind(null, s.id)} submit="Ship it" className="formrow" style={{ flex: "1 1 480px" }}
                            confirm={`Ship ${s.code}? Every item moves to ${s.partner}'s stock.`}>
                  <label className="fl">Shipped on<input className="fld" type="date" name="shippedOn" defaultValue={today} max={today} /></label>
                  <label className="fl">Courier<input className="fld" name="courier" defaultValue={s.courier ?? ""} /></label>
                  <label className="fl">Tracking number<input className="fld mono" name="trackingNumber" defaultValue={s.trackingNumber ?? ""} /></label>
                </ActionForm>
                <ActionForm action={cancel.bind(null, s.id)} submit="Cancel shipment" danger confirm={`Cancel ${s.code}?`} />
              </>
            )}
            {s.status === "shipped" && <ActionForm action={received.bind(null, s.id)} submit="Partner received it" />}
          </div>
        </section>
      )}
    </main>
  );
}
