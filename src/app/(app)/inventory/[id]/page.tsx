import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { Icon, type IconName } from "@/components/icons";
import { StageBadge, UNIT_STATUSES, UnitStatus } from "@/components/status";
import { unitDetail } from "@/server/queries/inventory";
import { allLocations, lookups } from "@/server/queries/places";
import { getPermissions, requireApprovedUser } from "@/server/session";
import { fixUnit } from "../../corrections/actions";
import { backFrom, repair, retire, toSupplier } from "../actions";

// One item's full story (design/DeviceDetail.dc.html): what it is, where it is now, its SIM link,
// how far along its life it is, and every change — who, when, why.
// Not built (no data behind it yet): notes & attachments, editable identity fields (MAC, firmware…).

const MOVE: Record<string, [string, IconName]> = {
  receive: ["Received", "receive"],
  serialise: ["Given a serial number", "chip"],
  deploy: ["Deployed", "deployment"],
  ship: ["Shipped to partner", "ship"],
  deploy_abroad: ["Deployed abroad", "deployment"],
  return: ["Returned to MRD Office", "inventory"],
  send_repair: ["Sent for repair", "prep"],
  back_from_repair: ["Back from repair", "prep"],
  return_to_supplier: ["Returned to supplier", "batches"],
  write_off: ["Written off", "audit"],
  correction: ["Corrected by Super Admin", "settings"],
};

const muscat = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Muscat" });
const when = (d: Date | string | null) => (d ? muscat.format(new Date(d)).replace("Sept", "Sep") : "—");
const short = (d: Date | string | null) =>
  d ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Muscat" }).format(new Date(d)).replace("Sept", "Sep") : "";
// calendar dates arrive as midnight UTC
const day = (d: Date | string | null) =>
  d ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(d)).replace("Sept", "Sep") : "—";
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

function Avatar({ name }: { name: string }) {
  return <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#E3F4F1", fontSize: 9.5, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials(name)}</span>;
}

function Change({ label, from, to }: { label: string; from: string | null; to: string | null }) {
  return (
    <span className="chg">{label}<span className="o">{from ?? "none"}</span><span aria-hidden="true">→</span><span className="n">{to ?? "none"}</span></span>
  );
}

// A header button that opens its form in a small panel below it.
function ActionPanel({ label, title, primary, danger, children }: { label: string; title?: string; primary?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <details className="actd">
      <summary className={primary ? "btn p" : "btn"} style={danger ? { color: "#A3201F" } : undefined}>{label}</summary>
      <div className="pop">
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </details>
  );
}

export default async function ItemPage({ params }: PageProps<"/inventory/[id]">) {
  const user = await requireApprovedUser();
  const { id } = await params;
  const unitId = Number(id);
  if (!Number.isInteger(unitId) || unitId <= 0) notFound();

  const isSuper = user.role === "super_admin";
  const [detail, permissions, lists, locations] = await Promise.all([
    unitDetail(user.id, { unitId }).catch(() => null),
    getPermissions(user.id), lookups(user.id), isSuper ? allLocations(user.id) : Promise.resolve([]),
  ]);
  if (!detail) notFound();
  const u = detail;
  const current = u.simHistory.find((s) => !s.endedAt);
  const firstLink = u.simHistory[0];

  // What can happen to it next, depending on where it is (SIMs inside a router move with the router)
  const simInRouter = u.isSim && !!current;
  const gone = ["retired", "returned_to_supplier"].includes(u.status);
  const canMove = permissions.has("inventory.move") && !simInRouter && !gone;
  const inOffice = u.place === "office";
  const atFacility = u.place === "facility";
  const inRepair = u.status === "in_repair";
  const canDeploy = permissions.has("deployments.create") && inOffice && !simInRouter && !gone && !u.reservation
    && (!u.needsConfiguration || !!current);
  const routerSim = !u.isSim && current; // a router with a SIM: ask what happens to the SIM
  const simChoice = routerSim ? (
    <label className="fl">Its SIM ({current.otherSerial})
      <select className="fld" name="sim" required defaultValue="spare">
        <option value="spare">Keep the SIM as a spare (back to MRD Office)</option>
        <option value="retire">Retire the SIM</option>
      </select>
    </label>
  ) : null;

  const firstMove = u.movements[0];
  const deployMoves = u.movements.filter((m) => m.type === "deploy" || m.type === "deploy_abroad" || m.type === "ship");
  const lastDeploy = deployMoves[deployMoves.length - 1];
  const returned = lastDeploy && u.movements.some((m) => m.id > lastDeploy.id && m.type === "return");
  const dep = atFacility ? u.deployment : null;

  // Lifecycle: received → (configured, for routers) → deployed → returned / transferred
  type Step = { label: string; sub: string; done: boolean; optional?: boolean };
  const steps: Step[] = [
    { label: "Received", sub: `${day(u.receivedOn)}${firstMove ? ` · ${firstMove.by.split(" ")[0]}` : ""}`, done: true },
  ];
  if (u.needsConfiguration) {
    steps.push({ label: "SIM & IP assigned", sub: firstLink ? `${short(firstLink.assignedAt)} · ${firstLink.assignedBy.split(" ")[0]}` : "Not yet", done: !!firstLink });
  }
  steps.push({ label: lastDeploy?.type === "ship" ? "Shipped to partner" : "Deployed", sub: lastDeploy ? `${short(lastDeploy.movedAt)} · ${lastDeploy.to ?? ""}` : "Not yet", done: !!lastDeploy });
  steps.push(gone
    ? { label: u.status === "retired" ? "Written off" : "Returned to supplier", sub: when(u.movements[u.movements.length - 1]?.movedAt ?? null), done: true }
    : { label: "Returned / transferred", sub: returned ? "Back in MRD Office" : "Optional", done: !!returned, optional: true });
  const lastDone = steps.map((s) => s.done).lastIndexOf(true);
  const nextStep = steps.find((s) => !s.done && !s.optional);

  // History, newest first: stock movements plus SIM changes
  type Event = { key: string; at: Date; title: ReactNode; icon: IconName; by: string; body: ReactNode };
  const events: Event[] = [
    ...u.movements.map((m): Event => ({
      key: `m${m.id}`, at: new Date(m.movedAt), icon: MOVE[m.type]?.[1] ?? "inventory", by: m.by,
      title: <>{MOVE[m.type]?.[0] ?? m.type}{m.document && <> · <span className="mono">{m.document}</span></>}</>,
      body: <>
        {(m.from || m.to) && <Change label="Location" from={m.from} to={m.to} />}
        {m.note && <span style={{ fontSize: 12.5, color: "#3B4758" }}>“{m.note}”</span>}
      </>,
    })),
    ...u.simHistory.flatMap((s, i): Event[] => {
      const what = u.isSim ? "router" : "SIM";
      const list: Event[] = [{
        key: `a${i}`, at: new Date(s.assignedAt), icon: "sim", by: s.assignedBy,
        title: u.isSim ? "Put in a router" : "SIM assigned",
        body: <>
          <Change label={u.isSim ? "Router" : "SIM"} from={null} to={s.otherSerial} />
          {s.ipAddress && <Change label="IP" from={null} to={s.ipAddress} />}
        </>,
      }];
      if (s.endedAt) list.push({
        key: `e${i}`, at: new Date(s.endedAt), icon: "sim", by: s.endedBy ?? "—",
        title: u.isSim ? "Taken out of the router" : "SIM removed",
        body: <Change label={what === "SIM" ? "SIM" : "Router"} from={s.otherSerial} to={null} />,
      });
      return list;
    }),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const answers: [string, ReactNode][] = [
    ["What is it?", `${u.model} ${u.isSim ? "SIM" : u.needsConfiguration ? "router" : ""}`.trim()],
    ["Which batch?", <Link key="b" className="mono" href={`/inventory?q=${encodeURIComponent(u.batchCode)}`} style={{ color: "#0E1726" }}>{u.batchCode}</Link>],
    ["Where now?", u.location],
  ];
  if (u.needsConfiguration || u.isSim) {
    answers.push(
      ["Who configured?", current ? `${current.assignedBy} · ${when(current.assignedAt)}` : "— not yet"],
      [u.isSim ? "Which router?" : "Which SIM?", current ? <Link key="o" className="mono" href={`/inventory/${current.otherUnitId}`}>{current.otherSerial}</Link> : "— none"],
      ["What IP?", <span key="ip" className="mono">{current?.ipAddress ?? "—"}</span>],
    );
  }
  answers.push(
    ["Which facility?", dep ? <Link key="f" href={`/facilities/${dep.facilityId}`} style={{ color: "#0E1726" }}>{dep.facility}</Link> : "— not deployed"],
    ["POC or Contract?", dep ? (dep.type === "poc" ? "POC" : "Contract") : "— not deployed"],
  );

  const photoIcon: IconName = u.isSim ? "sim" : u.needsConfiguration ? "router" : "chip";
  const chain: { label: string; value: string; href?: string; pending?: boolean }[] = [
    { label: "Supplier", value: u.supplier },
    { label: "Batch", value: u.batchCode },
    { label: u.isSim ? "SIM" : "Device", value: u.serial },
  ];
  if (!u.isSim && u.needsConfiguration) {
    chain.push({ label: "SIM", value: current ? `…${current.otherSerial.slice(-4)}` : "None", href: current ? `/inventory/${current.otherUnitId}` : undefined, pending: !current });
    chain.push({ label: "IP", value: current?.ipAddress ?? "None", pending: !current?.ipAddress });
  }
  if (u.isSim) chain.push({ label: "Router", value: current?.otherSerial ?? "None", href: current ? `/inventory/${current.otherUnitId}` : undefined, pending: !current });
  chain.push(dep ? { label: "Facility", value: dep.facility, href: `/facilities/${dep.facilityId}` } : { label: "Facility", value: "Pending deployment", pending: true });

  return (
    <main className="main">
      <nav className="bc" aria-label="Breadcrumb">
        <Link href="/inventory">Inventory</Link><span aria-hidden="true">/</span>
        <Link href={`/inventory?productId=${u.productId}`}>{u.product}</Link><span aria-hidden="true">/</span>
        <span className="mono" style={{ color: "#0E1726" }}>{u.serial}</span>
      </nav>

      <section className="card" style={{ padding: "20px 22px", display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ width: 112, height: 112, borderRadius: 12, background: "#F1F4F7", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#3B4758", flex: "0 0 112px" }}>
          <Icon name={photoIcon} size={30} />
          <span className="muted" style={{ fontSize: 11.5 }}>{u.brand}</span>
        </div>
        <div style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="ov">{u.brand} · {u.model}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 className="h1">{u.product}</h1>
            <UnitStatus status={u.status} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="muted">{u.isSim ? "ICCID" : "S/N"}</span>
            <span className="mono" style={{ fontSize: 19, fontWeight: 500 }}>{u.serial}</span>
            <CopyButton value={u.serial} label={u.isSim ? "ICCID" : "serial number"} text />
          </div>
          <div style={{ display: "flex", gap: "6px 20px", flexWrap: "wrap" }}>
            <span className="fact"><Icon name="facility" size={15} />{u.location}</span>
            <span className="fact"><Icon name="batches" size={15} />Batch <span className="mono" style={{ color: "#0B7A6B" }}>{u.batchCode}</span></span>
            {current && !u.isSim && <span className="fact"><Icon name="prep" size={15} />Configured by <span style={{ color: "#0B7A6B" }}>{current.assignedBy}</span> · {when(current.assignedAt)}</span>}
            <span className="fact"><Icon name="deployment" size={15} />Deployment: {dep ? <Link href={`/deployments/${dep.id}`} className="mono">{dep.code}</Link> : u.reservation ? `reserved on ${u.reservation.code}` : "Not yet deployed"}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {canDeploy && <Link className="btn p" href="/deployments/new"><Icon name="deployment" size={16} />Deploy</Link>}
          {canMove && (inOffice || u.status === "deployed") && (
            <ActionPanel label="Send for repair" title="Send for repair">
              <ActionForm action={repair.bind(null, u.unitId)} submit="Send for repair" className="formrow">
                <label className="fl">To
                  <select className="fld" name="to" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {lists.repairCompanies.map((r) => <option key={`r${r.id}`} value={`repair:${r.id}`}>{r.name} (repair company)</option>)}
                    {lists.suppliers.map((x) => <option key={`s${x.id}`} value={`supplier:${x.id}`}>{x.name} (supplier)</option>)}
                  </select>
                </label>
                {simChoice}
                <label className="fl">Fault / note<input className="fld" name="note" placeholder="e.g. No power" /></label>
              </ActionForm>
            </ActionPanel>
          )}
          {canMove && (inOffice || u.place === "repair_company") && (
            <ActionPanel label="Return to supplier" title="Return to supplier (e.g. warranty)">
              <ActionForm action={toSupplier.bind(null, u.unitId)} submit="Return to supplier" className="formrow">
                <label className="fl">Supplier
                  <select className="fld" name="supplierId" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {lists.suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
                {simChoice}
                <label className="fl">Note<input className="fld" name="note" /></label>
              </ActionForm>
            </ActionPanel>
          )}
          {canMove && (
            <ActionPanel label="Write off" title="Write off" danger>
              <ActionForm action={retire.bind(null, u.unitId)} submit="Write off" className="formrow"
                          confirm={`Write off ${u.serial}? It can never be used again (a Super Admin can correct a mistake).`}>
                {simChoice}
                <label className="fl">Reason<input className="fld" name="reason" required placeholder="e.g. Water damage" /></label>
              </ActionForm>
            </ActionPanel>
          )}
          {isSuper && !simInRouter && (
            <ActionPanel label="Correct this item" title="Correct this item (Super Admin)">
              <p className="muted" style={{ fontSize: 12.5 }}>
                For mistakes only, e.g. recorded at the wrong site or written off by mistake. A router&apos;s SIM is corrected with it.
              </p>
              <ActionForm action={fixUnit.bind(null, u.unitId)} submit="Record correction" className="formrow" confirm="Record this correction?">
                <label className="fl">Where it really is
                  <select className="fld" name="locationId" defaultValue="">
                    <option value="">Same place ({u.location})</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
                <label className="fl">Status it really has
                  <select className="fld" name="status" defaultValue={u.status}>
                    {UNIT_STATUSES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="fl" style={{ flexBasis: "100%" }}>Reason<input className="fld" name="reason" required placeholder="e.g. Found in the store room" /></label>
              </ActionForm>
            </ActionPanel>
          )}
        </div>
      </section>

      {canMove && inRepair && (
        <section className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10, borderColor: "#F3D9A6", background: "#FFFBF2" }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>In repair at {u.location}</h2>
          <ActionForm action={backFrom.bind(null, u.unitId)} submit="Back in MRD Office" className="formrow">
            <label className="fl">Note<input className="fld" name="note" placeholder="e.g. Board replaced" /></label>
          </ActionForm>
        </section>
      )}

      <section className="card" aria-label="Key answers" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", overflow: "hidden" }}>
        {answers.map(([q, a]) => (
          <div key={q} className="ans"><span className="q">{q}</span><span className="a">{a}</span></div>
        ))}
      </section>

      <section className="card" aria-label="Lifecycle" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Lifecycle</h2>
          <span className="muted" style={{ fontSize: 13 }}>
            {steps.filter((s) => s.done).length} of {steps.length} stages complete
            {nextStep && <> · next: <span style={{ color: "#0B7A6B" }}>{nextStep.label}</span></>}
          </span>
        </div>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`, gap: 0 }}>
          {steps.map((s, i) => {
            const cls = i === lastDone ? "step cur" : s.done ? "step done" : s === nextStep ? "step next" : "step";
            return (
              <li key={s.label} className={cls} aria-current={i === lastDone ? "step" : undefined}>
                <span style={{ display: "flex", alignItems: "center" }}>
                  <span className="dot" aria-hidden="true">
                    {s.done ? <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
                            : <span style={{ fontSize: 11, fontWeight: 600 }}>{i + 1}</span>}
                  </span>
                  {i < steps.length - 1 && <span className="ln" style={s.done && steps[i + 1].done ? { background: "#0B7A6B" } : undefined} />}
                </span>
                <span style={{ fontSize: 13, fontWeight: 500, paddingRight: 8 }}>{s.label}</span>
                <span className="muted" style={{ fontSize: 12, paddingRight: 8 }}>{i === lastDone && !gone ? `Current · ${s.sub}` : s.sub}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="hd"><h2>Identity</h2></div>
            {([
              ["Product", u.product, null],
              ["Brand / model", `${u.brand} ${u.model}`, null],
              [u.isSim ? "ICCID" : "Serial number", u.serial, "mono"],
              ...(u.imei ? [["IMEI", u.imei, "mono"]] : []),
              ["Batch", u.batchCode, "mono"],
              ["Supplier", u.supplier, null],
              ["Received", day(u.receivedOn), null],
            ] as [string, string, string | null][]).map(([k, v, cls]) => (
              <div key={k} className="kv" style={{ gridTemplateColumns: "130px minmax(0,1fr) 28px" }}>
                <span className="k">{k}</span><span className={cls ?? undefined}>{v}</span>
                {cls === "mono" ? <CopyButton value={v} label={k} /> : <span />}
              </div>
            ))}
          </div>

          {(u.isSim || u.needsConfiguration) && (
            <div className="card">
              <div className="hd"><h2>Connectivity</h2>{current && <Link href={`/inventory/${current.otherUnitId}`} style={{ fontSize: 13, fontWeight: 500 }}>{u.isSim ? "Router record →" : "SIM record →"}</Link>}</div>
              {u.isSim ? (
                <>
                  <div className="kv"><span className="k">Carrier</span><span>{u.carrier ?? "—"}</span></div>
                  <div className="kv"><span className="k">Phone number</span><span className="mono">{u.phoneNumber ? `+${u.phoneNumber}` : "—"}</span></div>
                  <div className="kv"><span className="k">In router</span>{current ? <Link className="mono" href={`/inventory/${current.otherUnitId}`}>{current.otherSerial}</Link> : <span>Not in a router</span>}</div>
                  <div className="kv"><span className="k">IP address</span><span className="mono">{current?.ipAddress ?? "—"}</span></div>
                </>
              ) : (
                <>
                  <div className="kv" style={{ gridTemplateColumns: "130px minmax(0,1fr) 28px" }}><span className="k">ICCID</span>
                    {current ? <><Link className="mono" href={`/inventory/${current.otherUnitId}`}>{current.otherSerial}</Link><CopyButton value={current.otherSerial} label="ICCID" /></> : <><span>No SIM yet</span><span /></>}</div>
                  <div className="kv" style={{ gridTemplateColumns: "130px minmax(0,1fr) 28px" }}><span className="k">IP address</span>
                    <span className="mono">{current?.ipAddress ?? "—"}</span>{current?.ipAddress ? <CopyButton value={current.ipAddress} label="IP address" /> : <span />}</div>
                  <div className="kv"><span className="k">Since</span><span>{current ? `${when(current.assignedAt)} · ${current.assignedBy}` : "—"}</span></div>
                </>
              )}
            </div>
          )}

          <div className="card">
            <div className="hd"><h2>Deployment</h2>{dep && <Link href={`/deployments/${dep.id}`} style={{ fontSize: 13, fontWeight: 500 }}>Open {dep.code} →</Link>}</div>
            {dep ? (
              <>
                <div className="kv"><span className="k">Facility</span><Link href={`/facilities/${dep.facilityId}`}>{dep.facility}</Link></div>
                <div className="kv"><span className="k">Project stage</span><span><StageBadge stage={dep.stage} /></span></div>
                <div className="kv"><span className="k">Type</span><span><span className={dep.type === "poc" ? "t t-poc" : "t t-con"}>{dep.type === "poc" ? "POC" : "Contract"}</span></span></div>
                <div className="kv"><span className="k">Placement</span><span>{[dep.building, dep.position].filter(Boolean).join(" · ") || "—"}</span></div>
                <div className="kv"><span className="k">Date</span><span>{day(dep.date)}</span></div>
              </>
            ) : (
              <div style={{ padding: "8px 24px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                <span style={{ width: 44, height: 44, borderRadius: 12, background: "#F1F4F7", display: "flex", alignItems: "center", justifyContent: "center", color: "#3B4758" }}><Icon name="deployment" size={20} /></span>
                <strong style={{ fontSize: 14 }}>{u.reservation ? `Reserved on ${u.reservation.code}` : atFacility ? "At a facility" : "Not deployed"}</strong>
                <p className="muted" style={{ fontSize: 13, maxWidth: 360 }}>
                  {u.reservation
                    ? <>On the {u.reservation.status} {u.reservation.kind} to {u.reservation.to}. <Link href={`/${u.reservation.kind}s/${u.reservation.id}`}>Open it →</Link></>
                    : u.needsConfiguration && !current ? "This router needs a SIM before it can be deployed."
                    : inOffice ? "Deploy it on a POC or contract deployment; the facility, placement and stage are recorded there."
                    : `It is at ${u.location}.`}
                </p>
                {canDeploy && <Link className="btn p sm" href="/deployments/new">Deploy device</Link>}
                {permissions.has("inventory.prepare") && u.needsConfiguration && !current && inOffice && <Link className="btn p sm" href="/prep">Prepare it</Link>}
              </div>
            )}
          </div>
        </div>

        <div className="card" style={{ flex: "1.4 1 420px", minWidth: 0 }}>
          <div className="hd">
            <div><h2>History</h2><p className="muted" style={{ fontSize: 13 }}>Every change, who made it and why</p></div>
          </div>
          <div style={{ padding: "4px 18px 8px" }}>
            {events.map((e) => (
              <div key={e.key} className="ev">
                <span className="rail" aria-hidden="true" />
                <span className="ic" style={{ background: "#F1F4F7", color: "#3B4758", border: "1px solid #E3E7EC" }} aria-hidden="true"><Icon name={e.icon} size={15} /></span>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{e.title}</span>
                    <span className="muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}><Avatar name={e.by} />{e.by} · {when(e.at)}</span>
                  </span>
                  {e.body}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 18px", borderTop: "1px solid #EEF1F4", fontSize: 12.5 }}>
            <span className="muted">{events.length} {events.length === 1 ? "event" : "events"} · times in Gulf Standard Time</span>
            {permissions.has("audit.view") && <Link href={`/audit?table=units`}>Full audit log →</Link>}
          </div>
        </div>
      </section>

      <section className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Traceability</h2>
          <span className="muted" style={{ fontSize: 12.5 }}>{chain.map((c) => c.label).join(" → ")}</span>
        </div>
        <div className="chain">
          {chain.map((c, i) => (
            <span key={c.label} style={{ display: "contents" }}>
              {i > 0 && <span className="muted" aria-hidden="true">→</span>}
              {c.href
                ? <Link className="lk" href={c.href}><span className="muted" style={{ fontSize: 12 }}>{c.label}</span><span className="mono">{c.value}</span></Link>
                : <span className={c.pending ? "lk pend" : "lk"}><span className="muted" style={{ fontSize: 12 }}>{c.label}</span><span className={c.pending || c.label === "Supplier" ? undefined : "mono"}>{c.value}</span></span>}
            </span>
          ))}
        </div>
      </section>
    </main>
  );
}
