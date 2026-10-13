import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { allLocations, lookups } from "@/server/queries/places";
import { requireApprovedUser } from "@/server/session";
import { fixStock } from "./actions";

// Corrections (Super Admin): fix a counted-stock mistake with a new, explained movement — history is
// never edited. Single items are corrected from their own page.
export default async function CorrectionsPage() {
  const user = await requireApprovedUser();
  if (user.role !== "super_admin") {
    return <main className="main"><div className="alert err">Only a Super Admin can record corrections.</div></main>;
  }
  const [lists, locations] = await Promise.all([lookups(user.id), allLocations(user.id)]);
  const counted = lists.products.filter((p) => p.tracking !== "serialised");
  return (
    <main className="main" style={{ maxWidth: 900 }}>
      <div>
        <nav aria-label="Breadcrumb" className="bc"><Link href="/">Dashboard</Link><span aria-hidden="true">/</span><span>Corrections</span></nav>
        <h1 className="h1">Corrections</h1>
        <p className="muted">Fix a mistake without rewriting history: a correction is a new movement with your name and a reason.
          To correct one item (wrong place or status), open it and use “Correct this item”.</p>
      </div>
      <section className="card">
        <div className="sh"><div><h2>Counted stock</h2><p>e.g. a recount found 2 more cables in the office.</p></div></div>
        <div style={{ padding: "0 18px 18px" }}>
          <ActionForm action={fixStock} submit="Record correction" className="formrow" confirm="Record this correction?">
            <label className="fl">Product
              <select className="fld" name="productId" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {counted.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="fl">Where
              <select className="fld" name="locationId" required defaultValue={locations.find((l) => l.type === "office")?.id}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="fl">Add or remove
              <select className="fld" name="direction" defaultValue="add">
                <option value="add">Add (found more)</option>
                <option value="remove">Remove (fewer than recorded)</option>
              </select>
            </label>
            <label className="fl">How many<input className="fld" type="number" name="amount" min={1} required /></label>
            <label className="fl" style={{ flexBasis: "100%" }}>Reason<input className="fld" name="reason" required placeholder="e.g. Monthly recount" /></label>
          </ActionForm>
        </div>
      </section>
    </main>
  );
}
