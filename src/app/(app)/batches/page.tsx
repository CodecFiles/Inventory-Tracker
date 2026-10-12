import Link from "next/link";
import { listBatches } from "@/server/queries/documents";
import { getPermissions, requireApprovedUser } from "@/server/session";

// Batches (design/Batches.dc.html): every delivery received, newest first.
export default async function BatchesPage() {
  const user = await requireApprovedUser();
  const [permissions, batches] = await Promise.all([getPermissions(user.id), listBatches(user.id, { limit: 200 })]);
  return (
    <main className="main">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <nav aria-label="Breadcrumb" className="bc"><Link href="/">Dashboard</Link><span aria-hidden="true">/</span><span>Batches</span></nav>
          <h1 className="h1">Batches</h1>
          <p className="muted">Every delivery received into MRD Office.</p>
        </div>
        {permissions.has("inventory.receive") && <Link className="btn p" href="/receive">Receive stock</Link>}
      </div>
      <section className="card">
        {batches.length === 0 ? <div className="empty">No deliveries received yet.</div> : (
          <div className="tw">
            <table className="tbl">
              <thead><tr><th>Batch</th><th>Received</th><th>Supplier</th><th className="num">Items</th><th>Invoice</th><th>PO</th><th>By</th></tr></thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="mono"><Link href={`/batches/${b.id}`}>{b.code}</Link></td>
                    <td>{new Date(b.receivedOn).toISOString().slice(0, 10)}</td>
                    <td>{b.supplier}</td>
                    <td className="num">{b.itemsReceived}</td>
                    <td className="mono muted">{b.invoiceNumber ?? "—"}</td>
                    <td className="mono muted">{b.purchaseOrder ?? "—"}</td>
                    <td className="muted">{b.receivedBy}</td>
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
