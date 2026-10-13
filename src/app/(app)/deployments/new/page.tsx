import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { listFacilities } from "@/server/queries/places";
import { getPermissions, requireApprovedUser } from "@/server/session";
import { newDeployment } from "../actions";

// New deployment (design/CreateDeployment.dc.html), step 1: where and what kind. Items are added on
// the deployment's own page; nothing moves until it is completed.
export default async function NewDeploymentPage({ searchParams }: PageProps<"/deployments/new">) {
  const user = await requireApprovedUser();
  const permissions = await getPermissions(user.id);
  if (!permissions.has("deployments.create")) {
    return <main className="main"><div className="alert err">You do not have permission to create deployments.</div></main>;
  }
  const { facility } = await searchParams;
  const facilities = (await listFacilities(user.id, { limit: 200 })).filter((f) => f.stage !== "closed");
  return (
    <main className="main" style={{ maxWidth: 820 }}>
      <div>
        <nav aria-label="Breadcrumb" className="bc"><Link href="/deployments">Deployments</Link><span aria-hidden="true">/</span><span>New deployment</span></nav>
        <h1 className="h1">New deployment</h1>
        <p className="muted">Start a draft; add routers and items next. A closed facility must be re-opened first (A9).</p>
      </div>
      <section className="card" style={{ padding: 18 }}>
        {facilities.length === 0 ? <div className="alert warn">No open facilities. <Link href="/facilities">Add one</Link> first.</div> : (
          <ActionForm action={newDeployment} submit="Create draft" className="formrow">
            <label className="fl">Facility
              <select className="fld" name="facilityId" required defaultValue={typeof facility === "string" ? facility : ""}>
                <option value="" disabled>Choose…</option>
                {facilities.map((f) => <option key={f.id} value={f.id}>{f.name} · {f.client} ({f.country})</option>)}
              </select>
            </label>
            <label className="fl">Type
              <select className="fld" name="type" defaultValue="poc">
                <option value="poc">POC (trial)</option>
                <option value="contract">Contract</option>
              </select>
            </label>
            <label className="fl">Planned date (optional)<input className="fld" type="date" name="deploymentDate" /></label>
            <label className="fl" style={{ flexBasis: "100%" }}>Notes (optional)<input className="fld" name="notes" /></label>
          </ActionForm>
        )}
      </section>
    </main>
  );
}
