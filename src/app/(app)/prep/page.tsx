import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { AutoSubmitSelect } from "@/components/auto-submit";
import { Icon } from "@/components/icons";
import { listUnits, pendingSerialLines, type UnitRow } from "@/server/queries/inventory";
import { lookups } from "@/server/queries/places";
import { listFreeSims } from "@/server/inventory/prepare";
import { getPermissions, requireApprovedUser } from "@/server/session";
import { changeSim, configure, serialise } from "./actions";

// Device preparation (design/DevicePrep.dc.html) as a board: routers waiting for a SIM, counted items
// waiting for serial numbers, and routers that are ready. Prepare / Add serial numbers / Change SIM
// open a side panel (the address carries which one, so it can be shared or bookmarked).
// In MRD Office — or at a partner abroad, where MRD records the SIM and IP the partner used (A8).
// Not built (no data behind them yet): firmware, configuration profile, MAC address, sign-off steps.

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);
const day = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short" }).format(d).replace("Sept", "Sep");

function Column({ title, dot, count, hint, children }: { title: string; dot: string; count: number; hint: string; children: ReactNode }) {
  return (
    <section className="bcol" aria-label={title}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <h2><span style={{ width: 9, height: 9, borderRadius: "50%", background: dot }} />{title}<span className="n">{count}</span></h2>
        <span className="muted" style={{ fontSize: 12 }}>{hint}</span>
      </div>
      {children}
    </section>
  );
}

function Drawer({ title, sub, close, children }: { title: string; sub: ReactNode; close: string; children: ReactNode }) {
  return (
    <>
      <Link className="scrim-link" href={close} aria-label="Close panel" scroll={false} />
      <aside className="drawer" role="dialog" aria-label={title}>
        <div className="dh">
          <div><h2 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h2><p className="muted" style={{ fontSize: 13 }}>{sub}</p></div>
          <Link className="btn ic sm" href={close} aria-label="Close" scroll={false}>✕</Link>
        </div>
        {children}
      </aside>
    </>
  );
}

export default async function PrepPage({ searchParams }: PageProps<"/prep">) {
  const user = await requireApprovedUser();
  const permissions = await getPermissions(user.id);
  if (!permissions.has("inventory.prepare")) {
    return <main className="main"><div className="alert err">You do not have permission to prepare devices.</div></main>;
  }
  const sp = (await searchParams) as Params;
  const lists = await lookups(user.id);
  const atPartner = lists.partners.find((p) => String(p.id) === one(sp.partner));
  const product = one(sp.product);

  const [withoutSim, withSim, sims, pending] = await Promise.all([
    atPartner ? listUnits(user.id, { locationId: atPartner.locationId, routerSim: "without", limit: 200 })
              : listUnits(user.id, { unconfiguredRouters: true, limit: 200 }),
    listUnits(user.id, { ...(atPartner ? { locationId: atPartner.locationId } : { place: "office" }), routerSim: "with", limit: 200 }),
    listFreeSims(user.id, atPartner ? { partnerId: atPartner.id } : {}),
    atPartner ? Promise.resolve([]) : pendingSerialLines(user.id),
  ]);

  // product tabs: every product on the board
  const productCounts = new Map<string, number>();
  for (const r of [...withoutSim.rows, ...withSim.rows]) productCounts.set(r.product, (productCounts.get(r.product) ?? 0) + 1);
  for (const l of pending) productCounts.set(l.product, (productCounts.get(l.product) ?? 0) + l.received - l.serialised);
  const show = <T extends { product: string }>(xs: T[]) => (product ? xs.filter((x) => x.product === product) : xs);
  const waiting = show(withoutSim.rows);
  const ready = show(withSim.rows);
  const serialLines = show(pending);

  const base: Params = { partner: one(sp.partner), product };
  const href = (change: Params) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...base, ...change })) if (typeof v === "string" && v !== "") next.set(k, v);
    const s = next.toString();
    return s ? `/prep?${s}` : "/prep";
  };
  const close = href({});

  const carriers = new Map<string, number>();
  for (const s of sims) carriers.set(s.carrier ?? "Other", (carriers.get(s.carrier ?? "Other") ?? 0) + 1);
  const stillToSerialise = pending.reduce((a, l) => a + l.received - l.serialised, 0);
  const tiles = [
    { icon: "router" as const, label: "Waiting for a SIM", value: withoutSim.total, sub: atPartner ? `at ${atPartner.name}` : "routers in MRD Office" },
    { icon: "sim" as const, label: "Free SIMs", value: sims.length, sub: [...carriers].map(([c, n]) => `${n} ${c}`).join(" · ") || "none" },
    { icon: "chip" as const, label: "Waiting for serial numbers", value: stillToSerialise, sub: `${pending.length} ${pending.length === 1 ? "delivery line" : "delivery lines"}` },
    { icon: "deployment" as const, label: "Ready to deploy", value: withSim.total, sub: "routers with SIM + IP" },
  ];

  const simSelect = (
    <label className="fl">SIM (ICCID)
      <select className="fld mono" name="simUnitId" required defaultValue="">
        <option value="" disabled>{sims.length ? "Choose a free SIM…" : "No free SIMs here"}</option>
        {sims.map((s) => <option key={s.unitId} value={s.unitId}>{s.iccid}{s.phoneNumber ? ` · ${s.phoneNumber}` : ""}{s.carrier ? ` · ${s.carrier}` : ""}</option>)}
      </select>
    </label>
  );
  const ipInput = <label className="fl">IP address <span className="muted" style={{ fontWeight: 400 }}>(optional)</span><input className="fld mono" name="ipAddress" placeholder="10.64.12.37" /></label>;

  // the side panel, if one is open
  const unitOpen = one(sp.unit);
  const changeOpen = one(sp.change);
  const lineOpen = one(sp.line);
  const allRouters = [...withoutSim.rows, ...withSim.rows];
  const openRouter: UnitRow | undefined = allRouters.find((r) => String(r.unitId) === (unitOpen ?? changeOpen));
  const openLine = pending.find((l) => String(l.batchLineId) === lineOpen);
  const identity = (r: UnitRow) => (
    <div className="ds">
      <h3><span className="k">1</span>Identity <span className="b s-stock" style={{ marginLeft: "auto" }}>From receiving</span></h3>
      <div className="fgrid">
        <label className="fl">Serial number<input className="fld mono" value={r.serial} readOnly /></label>
        <label className="fl">IMEI<input className="fld mono" value={r.imei ?? "—"} readOnly /></label>
      </div>
      <span className="muted" style={{ fontSize: 12.5 }}>Batch <Link href={`/batches/${r.batchId}`} className="mono">{r.batchCode}</Link> · received {day(r.receivedOn)} · now at {r.location}</span>
    </div>
  );

  return (
    <main className="main">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <nav aria-label="Breadcrumb" className="bc"><Link href="/">Dashboard</Link><span aria-hidden="true">/</span><span>Devices</span><span aria-hidden="true">/</span><span style={{ color: "#0E1726" }}>Device preparation</span></nav>
          <h1 className="h1">Device preparation</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Put a SIM into each router and record its IP, and give counted items their serial numbers. {atPartner ? `Recording what ${atPartner.name} did in their stock.` : "In MRD Office."} Click <strong>Prepare</strong> on a card.
          </p>
        </div>
        <Form action="/prep" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <label className="fl">Where
            <AutoSubmitSelect className="fld" name="partner" defaultValue={atPartner?.id ?? ""} style={{ width: 260 }}>
              <option value="">MRD Office</option>
              {lists.partners.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.country})</option>)}
            </AutoSubmitSelect>
          </label>
        </Form>
      </div>

      <section className="card" aria-label="Preparation summary" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", overflow: "hidden" }}>
        {tiles.map((t) => (
          <div key={t.label} className="ans" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <span style={{ width: 36, height: 36, borderRadius: 9, background: "#E6F4F1", color: "#0B7A6B", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 36px" }}><Icon name={t.icon} size={18} /></span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span className="q">{t.label}</span>
              <span style={{ fontSize: 15 }}><strong style={{ fontSize: 18 }}>{t.value}</strong> <span className="muted" style={{ fontSize: 12.5 }}>· {t.sub}</span></span>
            </span>
          </div>
        ))}
      </section>

      <div className="cg" style={{ alignSelf: "flex-start" }} aria-label="Product">
        <Link className={product ? "chip" : "chip on"} href={href({ product: undefined })}>All products<span className="cn">{[...productCounts.values()].reduce((a, b) => a + b, 0)}</span></Link>
        {[...productCounts].map(([name, n]) => (
          <Link key={name} className={product === name ? "chip on" : "chip"} href={href({ product: name })}>{name}<span className="cn">{n}</span></Link>
        ))}
      </div>

      <div className="board">
        <Column title="No SIM yet" dot="#8A96A8" count={waiting.length} hint="received · needs SIM + IP">
          {waiting.length === 0 && <p className="muted" style={{ fontSize: 13, padding: 6 }}>Every router here has a SIM.</p>}
          {waiting.map((r) => (
            <article key={r.unitId} className={String(r.unitId) === unitOpen ? "bcard on" : "bcard"} aria-label={`Router ${r.serial}`}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <Link className="mono" href={`/inventory/${r.unitId}`} style={{ fontWeight: 600, color: "#0E1726" }}>{r.serial}</Link>
                <Link className="mono" href={`/batches/${r.batchId}`} style={{ fontSize: 11.5 }}>{r.batchCode}</Link>
              </span>
              <span style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 8 }}>
                <span><span style={{ display: "block", fontSize: 13.5 }}>{r.product}</span><span className="muted" style={{ fontSize: 12 }}>{r.location} · received {day(r.receivedOn)}</span></span>
                <Link className="btn sm p" href={href({ unit: String(r.unitId) })} scroll={false}>Prepare</Link>
              </span>
            </article>
          ))}
        </Column>

        <Column title="Waiting for serial numbers" dot="#E08A00" count={serialLines.length} hint="counted items">
          {atPartner && <p className="muted" style={{ fontSize: 13, padding: 6 }}>Serial numbers are added in MRD Office.</p>}
          {!atPartner && serialLines.length === 0 && <p className="muted" style={{ fontSize: 13, padding: 6 }}>Nothing is waiting for serial numbers.</p>}
          {serialLines.map((l) => (
            <article key={l.batchLineId} className={String(l.batchLineId) === lineOpen ? "bcard on" : "bcard"} aria-label={`${l.product} ${l.batchCode}`}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{l.product}</span>
                <span className="mono" style={{ fontSize: 11.5, color: "#0B7A6B" }}>{l.batchCode}</span>
              </span>
              <span style={{ height: 4, borderRadius: 2, background: "#EEF1F4" }}><span style={{ display: "block", height: 4, borderRadius: 2, width: `${(l.serialised / l.received) * 100}%`, background: "#E08A00" }} /></span>
              <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span className="muted" style={{ fontSize: 12 }}>{l.serialised} of {l.received} done</span>
                <Link className="btn sm" href={href({ line: String(l.batchLineId) })} scroll={false}>Add serial numbers</Link>
              </span>
            </article>
          ))}
        </Column>

        <Column title="Ready" dot="#2F6FE4" count={ready.length} hint="SIM + IP · can be deployed">
          {ready.length === 0 && <p className="muted" style={{ fontSize: 13, padding: 6 }}>No router with a SIM here yet.</p>}
          {ready.map((r) => (
            <article key={r.unitId} className={String(r.unitId) === changeOpen ? "bcard on" : "bcard"} aria-label={`Router ${r.serial}`}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <Link className="mono" href={`/inventory/${r.unitId}`} style={{ fontWeight: 600, color: "#0E1726" }}>{r.serial}</Link>
                <span className="b s-ready">Ready</span>
              </span>
              <span style={{ fontSize: 13.5 }}>{r.product}<span className="muted" style={{ fontSize: 12 }}> · {r.location}</span></span>
              <span className="mono" style={{ fontSize: 12, padding: "6px 8px", borderRadius: 6, background: "#F8FAFB" }}>
                IP {r.ipAddress ?? "—"} · SIM …{r.simIccid?.slice(-4)}
              </span>
              <span style={{ display: "flex", gap: 8 }}>
                {permissions.has("deployments.create") && !atPartner && <Link className="btn sm p" href="/deployments/new" style={{ flex: 1 }}>Deploy</Link>}
                <Link className="btn sm" href={href({ change: String(r.unitId) })} scroll={false} style={{ flex: 1 }}>Change SIM</Link>
              </span>
            </article>
          ))}
        </Column>
      </div>

      {openRouter && unitOpen && (
        <Drawer title={`Prepare ${openRouter.product}`} sub={<>S/N <span className="mono">{openRouter.serial}</span> · {openRouter.batchCode}</>} close={close}>
          {identity(openRouter)}
          {openRouter.simIccid ? (
            <div className="ds">
              <div className="alert ok">This router now has SIM <span className="mono">{openRouter.simIccid}</span>{openRouter.ipAddress ? <> and IP <span className="mono">{openRouter.ipAddress}</span></> : ""}. It is ready.</div>
              <Link className="btn" href={close} scroll={false}>Back to the board</Link>
            </div>
          ) : (
            <div className="ds">
              <h3><span className="k">2</span>SIM card and network</h3>
              <ActionForm action={configure.bind(null, openRouter.unitId)} submit="Put SIM in" className="formrow">
                {simSelect}{ipInput}
              </ActionForm>
              <span className="muted" style={{ fontSize: 12.5 }}>Putting the SIM in marks the router ready for deployment. A scanner typing into the boxes works too.</span>
            </div>
          )}
        </Drawer>
      )}

      {openRouter && changeOpen && (
        <Drawer title={`Change SIM · ${openRouter.serial}`} sub={<>Now SIM <span className="mono">{openRouter.simIccid}</span>{openRouter.ipAddress ? <> · IP <span className="mono">{openRouter.ipAddress}</span></> : null}</>} close={close}>
          {identity(openRouter)}
          <div className="ds">
            <h3><span className="k">2</span>New SIM</h3>
            <ActionForm action={changeSim.bind(null, openRouter.unitId)} submit="Change SIM" className="formrow">
              {simSelect}{ipInput}
              <label className="fl">The old SIM
                <select className="fld" name="oldSim" defaultValue="spare">
                  <option value="spare">Keep as a spare</option>
                  <option value="retire">Retire it (damaged / deactivated)</option>
                </select>
              </label>
            </ActionForm>
          </div>
        </Drawer>
      )}

      {openLine && (
        <Drawer title={`Serial numbers · ${openLine.product}`} sub={<>Batch <span className="mono">{openLine.batchCode}</span> · {openLine.serialised} of {openLine.received} done</>} close={close}>
          <div className="ds">
            <ActionForm action={serialise.bind(null, openLine.batchLineId)} submit="Save serial numbers" className="formrow">
              <label className="fl" style={{ flexBasis: "100%" }}>Serial numbers — one per line (up to {openLine.received - openLine.serialised})
                <textarea className="fld mono" name="serials" rows={8} required />
              </label>
            </ActionForm>
          </div>
        </Drawer>
      )}
    </main>
  );
}
