import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { DocStatus } from "@/components/status";
import { listShipments } from "@/server/queries/documents";
import { lookups } from "@/server/queries/places";
import { getPermissions, requireApprovedUser } from "@/server/session";
import { newShipment } from "./actions";

// Shipments to partners abroad — not in the original design (shipments came later, R4/R10); built
// from the design system's list and detail patterns (Stage 2 revision).
export default async function ShipmentsPage() {
  const user = await requireApprovedUser();
  const [permissions, rows, lists] = await Promise.all([getPermissions(user.id), listShipments(user.id, { limit: 200 }), lookups(user.id)]);
  return (
    <main className="main">
      <div>
        <nav aria-label="Breadcrumb" className="bc"><Link href="/">Dashboard</Link><span aria-hidden="true">/</span><span>Shipments</span></nav>
        <h1 className="h1">Shipments</h1>
        <p className="muted">Items sent from MRD Office to partners abroad. They stay in the partner&apos;s stock until deployed.</p>
      </div>
      {permissions.has("shipments.manage") && (
        <details className="card edit">
          <summary style={{ padding: "14px 18px", fontWeight: 600 }}>+ New shipment</summary>
          <div style={{ padding: "0 18px 18px" }}>
            {lists.partners.length === 0 ? <div className="alert warn">Add a partner first in <Link href="/settings?tab=partners">Settings → Partners</Link>.</div> : (
              <ActionForm action={newShipment} submit="Create draft" className="formrow">
                <label className="fl">Partner
                  <select className="fld" name="partnerId" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {lists.partners.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.country})</option>)}
                  </select>
                </label>
                <label className="fl">Courier (optional)<input className="fld" name="courier" placeholder="e.g. DHL" /></label>
                <label className="fl">Tracking number (optional)<input className="fld mono" name="trackingNumber" /></label>
              </ActionForm>
            )}
          </div>
        </details>
      )}
      <section className="card">
        {rows.length === 0 ? <div className="empty">No shipments yet.</div> : (
          <div className="tw">
            <table className="tbl">
              <thead><tr><th>Ref</th><th>Partner</th><th>Shipped</th><th>Courier · tracking</th><th className="num">Items</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="mono"><Link href={`/shipments/${s.id}`}>{s.code}</Link></td>
                    <td>{s.partner}<div className="muted" style={{ fontSize: 12 }}>{s.country}</div></td>
                    <td>{s.shippedOn ? new Date(s.shippedOn).toISOString().slice(0, 10) : "—"}</td>
                    <td className="muted">{[s.courier, s.trackingNumber].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="num">{s.items}</td>
                    <td><DocStatus status={s.status} /></td>
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
