import Link from "next/link";
import { notFound } from "next/navigation";
import { UnitStatus } from "@/components/status";
import { batchDetail } from "@/server/queries/documents";
import { requireApprovedUser } from "@/server/session";

// One delivery (design/BatchDetail.dc.html): what arrived and where each unit is now.
export default async function BatchPage({ params, searchParams }: PageProps<"/batches/[id]">) {
  const user = await requireApprovedUser();
  const { id } = await params;
  const { received } = await searchParams;
  let b;
  try {
    b = await batchDetail(user.id, { id: Number(id) });
  } catch {
    notFound();
  }
  const waitingForSerials = b.lines.filter((l) => l.tracking === "hybrid" && l.serialised < l.quantityReceived);

  return (
    <main className="main">
      <nav aria-label="Breadcrumb" className="bc"><Link href="/batches">Batches</Link><span aria-hidden="true">/</span><span className="mono">{b.code}</span></nav>
      {received && (
        <div role="status" className="alert ok">
          <span><strong>Batch <span className="mono">{b.code}</span> received.</strong> Everything below is now in MRD Office stock.
            {" "}<Link href="/prep">Prepare devices →</Link></span>
        </div>
      )}
      <section className="card" style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="ov">Batch</span>
        <h1 className="h1 mono">{b.code}</h1>
        <dl className="dl">
          <dt>Supplier</dt><dd>{b.supplier}</dd>
          <dt>Received</dt><dd>{new Date(b.receivedOn).toISOString().slice(0, 10)} · by {b.receivedBy}</dd>
          <dt>Invoice</dt><dd className="mono">{b.invoiceNumber ?? "—"}</dd>
          <dt>Purchase order</dt><dd className="mono">{b.purchaseOrder ?? "—"}</dd>
          {b.notes && <><dt>Notes</dt><dd>{b.notes}</dd></>}
        </dl>
      </section>

      <section className="card">
        <div className="sech"><h2>What arrived</h2></div>
        <div className="tw">
          <table className="tbl">
            <thead><tr><th>Product</th><th className="num">Received</th><th className="num">With serial numbers</th></tr></thead>
            <tbody>
              {b.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.product}</td>
                  <td className="num">{l.quantityReceived}</td>
                  <td className="num">{l.tracking === "quantity" ? "—" : l.serialised}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {waitingForSerials.length > 0 && (
          <div className="alert warn" style={{ margin: "0 18px 18px" }}>
            {waitingForSerials.map((l) => `${l.quantityReceived - l.serialised} × ${l.product}`).join(", ")} still need serial numbers — add them in <Link href="/prep">Device preparation</Link>.
          </div>
        )}
      </section>

      {b.units.length > 0 && (
        <section className="card">
          <div className="sech"><h2>Units</h2><span className="muted" style={{ fontSize: 12.5 }}>{b.units.length} with serial numbers</span></div>
          <div className="tw">
            <table className="tbl">
              <thead><tr><th>Product</th><th>Serial / ICCID</th><th>Status now</th></tr></thead>
              <tbody>
                {b.units.map((u) => (
                  <tr key={u.unitId}>
                    <td>{u.product}</td>
                    <td className="mono"><Link href={`/inventory/${u.unitId}`}>{u.serial}</Link></td>
                    <td><UnitStatus status={u.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
