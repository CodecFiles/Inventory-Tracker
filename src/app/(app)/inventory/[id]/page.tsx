import Link from "next/link";
import { notFound } from "next/navigation";
import { UnitStatus } from "@/components/status";
import { unitDetail } from "@/server/queries/inventory";
import { requireApprovedUser } from "@/server/session";

// One item's full story (design/DeviceDetail.dc.html): what it is, where it is now, its SIM link,
// and every movement — who, when, why. Actions (configure, deploy, return…) arrive in 6.3–6.4.

const MOVE: Record<string, [string, string, string]> = {
  // label, icon background, icon colour
  receive: ["Received", "#E3F2F6", "#0E5E73"],
  serialise: ["Given a serial number", "#E3F2F6", "#0E5E73"],
  deploy: ["Deployed", "#E1F4EC", "#0A6648"],
  ship: ["Shipped to partner", "#E9EDFC", "#3346A8"],
  deploy_abroad: ["Deployed abroad", "#E1F4EC", "#0A6648"],
  return: ["Returned to MRD Office", "#F1EEE8", "#5E554A"],
  send_repair: ["Sent for repair", "#FFEDE3", "#9A3D0B"],
  back_from_repair: ["Back from repair", "#E3F2F6", "#0E5E73"],
  return_to_supplier: ["Returned to supplier", "#F1EEE8", "#5E554A"],
  write_off: ["Written off", "#FDEBEA", "#A3201F"],
  correction: ["Correction (Super Admin)", "#F0EAFE", "#5B32B4"],
};

const when = (d: Date | string | null) =>
  d ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Muscat" }).format(new Date(d)) : "—";
const day = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

export default async function ItemPage({ params }: PageProps<"/inventory/[id]">) {
  const user = await requireApprovedUser();
  const { id } = await params;
  const unitId = Number(id);
  if (!Number.isInteger(unitId) || unitId <= 0) notFound();

  let u;
  try {
    u = await unitDetail(user.id, { unitId });
  } catch {
    notFound();
  }
  const current = u.simHistory.find((s) => !s.endedAt);
  const answers = [
    ["Where is it?", u.location],
    ["Status", <UnitStatus key="s" status={u.status} />],
    [u.isSim ? "In router" : "SIM inside",
     current ? <Link key="o" className="mono" href={`/inventory/${current.otherUnitId}`}>{current.otherSerial}</Link>
             : u.needsConfiguration || u.isSim ? "None" : "Not needed"],
    ["IP address", current?.ipAddress ?? "—"],
    ["Received", `${day(u.receivedOn)} · ${u.supplier}`],
    ["Movements", String(u.movements.length)],
  ] as const;

  return (
    <main className="main">
      <nav className="bc" aria-label="Breadcrumb">
        <Link href="/inventory">Inventory</Link><span aria-hidden="true">/</span>
        <Link href={`/inventory?productId=${u.productId}`}>{u.product}</Link><span aria-hidden="true">/</span>
        <span className="mono">{u.serial}</span>
      </nav>

      <section className="card" style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="ov">{u.brand} · {u.model}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 className="h1">{u.product}</h1>
          <UnitStatus status={u.status} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="muted">{u.isSim ? "ICCID" : "S/N"}</span>
          <span className="mono" style={{ fontSize: 15, fontWeight: 500 }}>{u.serial}</span>
          {u.imei && <><span className="muted" style={{ marginLeft: 12 }}>IMEI</span><span className="mono">{u.imei}</span></>}
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <span className="fact">{u.location}</span>
          <span className="fact">Batch <span className="mono">{u.batchCode}</span></span>
          <span className="fact">Supplier {u.supplier}</span>
        </div>
      </section>

      <section className="card" aria-label="Key answers" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", overflow: "hidden" }}>
        {answers.map(([q, a]) => (
          <div key={q} className="ans"><span className="q">{q}</span><span className="a">{a}</span></div>
        ))}
      </section>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {(u.isSim || u.needsConfiguration) && (
            <div className="card">
              <div className="hd"><h2>Connectivity</h2></div>
              {u.isSim ? (
                <>
                  <div className="kv"><span className="k">Carrier</span><span>{u.carrier ?? "—"}</span></div>
                  <div className="kv"><span className="k">Phone number</span><span className="mono">{u.phoneNumber ?? "—"}</span></div>
                  <div className="kv"><span className="k">In router</span>{current ? <Link className="mono" href={`/inventory/${current.otherUnitId}`}>{current.otherSerial}</Link> : <span>Not in a router</span>}</div>
                </>
              ) : (
                <>
                  <div className="kv"><span className="k">SIM (ICCID)</span>{current ? <Link className="mono" href={`/inventory/${current.otherUnitId}`}>{current.otherSerial}</Link> : <span>No SIM yet</span>}</div>
                  <div className="kv"><span className="k">IP address</span><span className="mono">{current?.ipAddress ?? "—"}</span></div>
                  <div className="kv"><span className="k">Since</span><span>{current ? `${when(current.assignedAt)} · ${current.assignedBy}` : "—"}</span></div>
                </>
              )}
            </div>
          )}
          <div className="card">
            <div className="hd"><h2>Identity</h2></div>
            <div className="kv"><span className="k">Product</span><span>{u.product}</span></div>
            <div className="kv"><span className="k">Brand / model</span><span>{u.brand} {u.model}</span></div>
            <div className="kv"><span className="k">{u.isSim ? "ICCID" : "Serial number"}</span><span className="mono">{u.serial}</span></div>
            <div className="kv"><span className="k">Batch</span><span className="mono">{u.batchCode}</span></div>
            <div className="kv"><span className="k">Received</span><span>{day(u.receivedOn)}</span></div>
          </div>
          {u.simHistory.length > 0 && (
            <div className="card">
              <div className="hd"><h2>{u.isSim ? "Router history" : "SIM history"}</h2></div>
              <div className="tw">
                <table className="tbl">
                  <thead><tr><th>{u.isSim ? "Router" : "SIM"}</th><th>IP</th><th>From</th><th>Until</th></tr></thead>
                  <tbody>
                    {u.simHistory.map((s, i) => (
                      <tr key={i}>
                        <td className="mono"><Link href={`/inventory/${s.otherUnitId}`}>{s.otherSerial}</Link></td>
                        <td className="mono">{s.ipAddress ?? "—"}</td>
                        <td>{day(s.assignedAt)}<div className="muted" style={{ fontSize: 12 }}>{s.assignedBy}</div></td>
                        <td>{s.endedAt ? <>{day(s.endedAt)}<div className="muted" style={{ fontSize: 12 }}>{s.endedBy}</div></> : <span className="b s-deployed">Current</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="card" style={{ flex: "1.4 1 420px", minWidth: 0 }}>
          <div className="hd">
            <div><h2>History</h2><p className="muted" style={{ fontSize: 13 }}>Every movement, who made it and why</p></div>
          </div>
          <div style={{ padding: "4px 18px 8px" }}>
            {u.movements.map((m) => {
              const [label, bg, fg] = MOVE[m.type] ?? [m.type, "#EEF1F5", "#3E4A5C"];
              return (
                <div key={m.id} className="ev">
                  <span className="rail" aria-hidden="true" />
                  <span className="ic" style={{ background: bg, color: fg }} aria-hidden="true">•</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 500 }}>
                      {label}{m.document && <> · <span className="mono">{m.document}</span></>}
                    </span>
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      {[m.from, m.to].filter(Boolean).join(" → ") || "—"}
                    </span>
                    {m.note && <span style={{ fontSize: 12.5, color: "#3B4758" }}>“{m.note}”</span>}
                    <span className="muted" style={{ fontSize: 12 }}>{when(m.movedAt)} · {m.by}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
