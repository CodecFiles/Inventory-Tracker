import Link from "next/link";
import { batchList } from "@/server/queries/batches";
import { lookups } from "@/server/queries/places";
import { getPermissions, requireApprovedUser } from "@/server/session";
import { ReceiveForm } from "./receive-form";

// Receive inventory (design/ReceiveInventory.dc.html): one delivery = one batch, entered in 3 steps.
export default async function ReceivePage() {
  const user = await requireApprovedUser();
  const permissions = await getPermissions(user.id);
  if (!permissions.has("inventory.receive")) {
    return <main className="main"><div className="alert err">You do not have permission to receive stock.</div></main>;
  }
  const [lists, recentBatches] = await Promise.all([lookups(user.id), batchList(user.id, { limit: 4 })]);
  const recent = recentBatches.rows.map((b) => ({
    id: b.id, code: b.code, product: b.product, lines: b.lines, quantity: b.quantity, supplier: b.supplier, receivedBy: b.receivedBy,
    receivedOn: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short" }).format(b.receivedOn).replace("Sept", "Sep"),
  }));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date());

  return (
    <main className="main">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <nav aria-label="Breadcrumb" className="bc"><Link href="/">Dashboard</Link><span aria-hidden="true">/</span><Link href="/batches">Batches</Link><span aria-hidden="true">/</span><span>Receive inventory</span></nav>
        <h1 className="h1">Receive inventory</h1>
        <p className="muted">Log a supplier delivery as a batch, record each unit&apos;s serial number and put it into MRD Office stock.</p>
      </div>
      {lists.suppliers.length === 0 || lists.products.length === 0 ? (
        <div className="alert warn">
          Add at least one supplier and one product first, in <Link href="/settings">Settings</Link>.
        </div>
      ) : (
        <ReceiveForm products={lists.products} suppliers={lists.suppliers} today={today} recent={recent} />
      )}
    </main>
  );
}
