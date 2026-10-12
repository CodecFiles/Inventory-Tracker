import Form from "next/form";
import Link from "next/link";
import { UnitStatus } from "@/components/status";
import { listUnits } from "@/server/queries/inventory";
import { requireApprovedUser } from "@/server/session";

// SIM cards (design/SimInventory.dc.html): every SIM, where it is and which router it is in.
const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

export default async function SimsPage({ searchParams }: PageProps<"/sims">) {
  const user = await requireApprovedUser();
  const sp = await searchParams;
  const q = one(sp.q);
  const free = one(sp.free) === "1";
  const data = await listUnits(user.id, { simsOnly: true, q, status: free ? "in_office" : undefined, limit: 200 });

  return (
    <main className="main">
      <div>
        <nav aria-label="Breadcrumb" className="bc"><Link href="/">Dashboard</Link><span aria-hidden="true">/</span><span>SIM cards</span></nav>
        <h1 className="h1">SIM cards</h1>
        <p className="muted">{data.total} SIM cards{free ? " free in MRD Office" : ""} · search by ICCID or phone number</p>
      </div>
      <section className="card">
        <Form action="/sims" style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "14px 18px", borderBottom: "1px solid #EEF1F4" }}>
          <input className="fld" name="q" defaultValue={q} placeholder="ICCID or phone number…" aria-label="Search SIM cards" style={{ flex: "1 1 260px", width: "auto" }} />
          <label className="fl" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="free" value="1" defaultChecked={free} /> Only free SIMs in the office
          </label>
          <button className="btn" type="submit">Filter</button>
        </Form>
        {data.rows.length === 0 ? <div className="empty">No SIM cards found.</div> : (
          <div className="tw">
            <table className="tbl">
              <thead><tr><th>ICCID</th><th>Phone</th><th>Product</th><th>Status</th><th>Location</th><th>In router</th></tr></thead>
              <tbody>
                {data.rows.map((s) => (
                  <tr key={s.unitId}>
                    <td className="mono"><Link href={`/inventory/${s.unitId}`}>{s.serial}</Link></td>
                    <td className="mono">{s.phoneNumber ?? "—"}</td>
                    <td>{s.product}</td>
                    <td><UnitStatus status={s.status} /></td>
                    <td>{s.location}</td>
                    <td className="mono">{s.inRouter ?? "—"}</td>
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
