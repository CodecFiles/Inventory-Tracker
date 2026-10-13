"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { receive } from "./actions";

// Receive a delivery as a 3-step wizard (design/ReceiveInventory.dc.html): 1 the shipment (supplier
// and paperwork), 2 the units (one or more products; serial numbers or ICCIDs pasted one per line —
// a barcode scanner typing into the box works too), 3 review and confirm. Nothing is saved until the
// last step; the server checks everything again and saves all lines or none.

type Product = { id: number; name: string; brand: string; model: string; tracking: string; isSim: boolean; needsConfiguration: boolean };
type Supplier = { id: number; name: string; codePrefix: string };
type Recent = { id: number; code: string; product: string; lines: number; quantity: number; supplier: string; receivedOn: string; receivedBy: string };
type Line = { key: number; productId: string; quantity: string; serials: string; phones: string; carrier: string };

const split = (t: string) => t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
let nextKey = 1;
const emptyLine = (): Line => ({ key: nextKey++, productId: "", quantity: "", serials: "", phones: "", carrier: "" });
const STEPS = [["Shipment", "Supplier, date, paperwork"], ["Units", "Products and serial numbers"], ["Review", "Check and confirm"]] as const;

function Pill({ tone, children }: { tone: "stock" | "prep" | "ready"; children: ReactNode }) {
  return <span className={`b s-${tone}`}>{children}</span>;
}

export function ReceiveForm({ products, suppliers, today, recent }: { products: Product[]; suppliers: Supplier[]; today: string; recent: Recent[] }) {
  const [step, setStep] = useState(1);
  const [supplierId, setSupplierId] = useState("");
  const [receivedOn, setReceivedOn] = useState(today);
  const [purchaseOrder, setPo] = useState("");
  const [invoiceNumber, setInvoice] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState("");
  const [problem, setProblem] = useState("");
  const [pending, startTransition] = useTransition();

  const byId = new Map(products.map((p) => [String(p.id), p]));
  const supplier = suppliers.find((s) => String(s.id) === supplierId);
  const update = (key: number, change: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)));

  // what each line amounts to, and whether it is complete
  const counted = lines.map((l) => {
    const p = byId.get(l.productId);
    const serials = split(l.serials);
    const serialised = p?.tracking === "serialised";
    const quantity = serialised ? serials.length : Number(l.quantity) || 0;
    const dup = serials.length !== new Set(serials).size;
    const done = !!p && quantity > 0 && !dup;
    return { l, p, serials, serialised, quantity, dup, done };
  });
  const allSerials = counted.flatMap((c) => c.serials);
  const crossDup = allSerials.length !== new Set(allSerials).size;
  const totalUnits = counted.reduce((a, c) => a + c.quantity, 0);
  const shipmentDone = !!supplierId && !!receivedOn;
  const unitsDone = counted.every((c) => c.done) && !crossDup;

  function next() {
    setProblem("");
    if (step === 1 && !shipmentDone) return setProblem("Choose the supplier and the date it arrived.");
    if (step === 2) {
      const bad = counted.findIndex((c) => !c.done);
      if (bad >= 0) {
        const c = counted[bad];
        return setProblem(!c.p ? `Product ${bad + 1}: choose the product.`
          : c.dup ? `Product ${bad + 1}: the same serial number is entered twice.`
          : c.serialised ? `Product ${bad + 1}: enter the ${c.p.isSim ? "ICCIDs" : "serial numbers"}, one per line.`
          : `Product ${bad + 1}: enter how many arrived.`);
      }
      if (crossDup) return setProblem("The same serial number appears under two products.");
    }
    setStep((s) => Math.min(3, s + 1));
  }

  function submit() {
    setError("");
    const payload = {
      supplierId: Number(supplierId),
      receivedOn,
      purchaseOrder: purchaseOrder || undefined,
      invoiceNumber: invoiceNumber || undefined,
      notes: notes || undefined,
      lines: counted.filter((c) => c.p).map(({ l, p, serials, serialised, quantity }) => ({
        productId: p!.id,
        quantity,
        serials: serialised ? serials : undefined,
        phoneNumbers: p!.isSim && l.phones.trim() ? split(l.phones) : undefined,
        carrier: p!.isSim && l.carrier.trim() ? l.carrier.trim() : undefined,
      })),
    };
    startTransition(async () => {
      const result = await receive(payload);
      if (result && !result.ok) setError(result.message);
    });
  }

  const firstProduct = counted.find((c) => c.p);
  const year = receivedOn.slice(0, 4) || today.slice(0, 4);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <nav aria-label="Steps" className="card" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", padding: 6, gap: 6 }}>
        {STEPS.map(([title, sub], i) => {
          const n = i + 1;
          const reachable = n === 1 || (n === 2 && shipmentDone) || (n === 3 && shipmentDone && unitsDone);
          return (
            <button key={title} type="button" onClick={() => reachable && (setProblem(""), setStep(n))} disabled={!reachable}
                    aria-current={step === n ? "step" : undefined}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 9, border: 0, textAlign: "left", font: "inherit",
                             cursor: reachable ? "pointer" : "default", background: step === n ? "#ECF7F4" : "transparent", color: "#0E1726" }}>
              <span style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 600, flex: "0 0 28px",
                             background: step === n ? "#0B7A6B" : step > n ? "#E6F4F1" : "#fff", color: step === n ? "#fff" : step > n ? "#0B7A6B" : "#3B4758",
                             border: step === n ? 0 : "1px solid #D5DBE3" }}>
                {step > n ? "✓" : n}
              </span>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</span>
                <span className="muted" style={{ fontSize: 12 }}>{sub}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "2 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {step === 1 && (
            <section className="card" aria-label="Shipment details">
              <div className="sh"><div><h2>Shipment details</h2><p>What arrived and from whom. It is received into MRD Office.</p></div></div>
              <div className="fgrid" style={{ padding: "0 18px 18px" }}>
                <label className="fl">Supplier
                  <select className="fld" name="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                    <option value="" disabled>Choose…</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.codePrefix})</option>)}
                  </select>
                </label>
                <label className="fl">Received date<input className="fld" type="date" value={receivedOn} max={today} onChange={(e) => setReceivedOn(e.target.value)} required /></label>
                <label className="fl">Purchase order <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
                  <input className="fld mono" name="purchaseOrder" value={purchaseOrder} onChange={(e) => setPo(e.target.value)} placeholder="e.g. PO-MRD-2026-0447" />
                </label>
                <label className="fl">Supplier invoice <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
                  <input className="fld mono" name="invoiceNumber" value={invoiceNumber} onChange={(e) => setInvoice(e.target.value)} placeholder="e.g. INV-AN-88341" />
                </label>
                <label className="fl" style={{ gridColumn: "1 / -1" }}>Notes <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
                  <textarea className="fld" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Condition on arrival, carton count, anything the prep team should know" />
                </label>
              </div>
            </section>
          )}

          {step === 2 && counted.map(({ l, p, serials, dup }, i) => (
            <section key={l.key} className="card" aria-label={`Product ${i + 1}`}>
              <div className="sh">
                <h2>Product {i + 1}</h2>
                {lines.length > 1 && (
                  <button type="button" className="btn sm dg" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button>
                )}
              </div>
              <div className="fgrid" style={{ padding: "0 18px 18px" }}>
                <label className="fl">Product
                  <select className="fld" name="productId" value={l.productId} onChange={(e) => update(l.key, { productId: e.target.value })} required>
                    <option value="" disabled>Choose…</option>
                    {products.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.brand} {x.model}</option>)}
                  </select>
                </label>
                {p && (
                  <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 12px", borderRadius: 10, background: "#F8FAFB", border: "1px solid #EEF1F4", fontSize: 13 }}>
                    <Pill tone="stock">{p.tracking === "serialised" ? "Serialised" : p.tracking === "hybrid" ? "Counted now, serials later" : "Counted"}</Pill>
                    {p.needsConfiguration && <Pill tone="prep">Needs a SIM + IP</Pill>}
                    {p.isSim && <Pill tone="ready">SIM card</Pill>}
                    <span className="muted">
                      {p.tracking === "serialised" ? "Each unit gets its own record." : p.tracking === "hybrid" ? "Counted now; serial numbers are added later in Device preparation." : "Only the quantity is kept."}
                      {p.needsConfiguration ? " Its SIM and IP are added in Device preparation." : ""}
                    </span>
                  </div>
                )}
                {p && p.tracking !== "serialised" && (
                  <label className="fl">Quantity received
                    <input className="fld" type="number" name="quantity" min={1} value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} required />
                  </label>
                )}
                {p && p.tracking === "serialised" && (
                  <label className="fl" style={{ gridColumn: "1 / -1" }}>
                    {p.isSim ? "ICCIDs" : "Serial numbers"} — one per line ({serials.length} entered{dup ? ", with duplicates!" : ""})
                    <textarea className="fld mono" name="serials" rows={6} value={l.serials} onChange={(e) => update(l.key, { serials: e.target.value })} required
                              placeholder={p.isSim ? "89968000000012300…\n89968000000012300…" : "1108675301\n1108675302"} />
                    {p.isSim && <span className="hint">An ICCID is 18–22 digits.</span>}
                  </label>
                )}
                {p?.isSim && (
                  <>
                    <label className="fl">Carrier <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
                      <input className="fld" name="carrier" value={l.carrier} onChange={(e) => update(l.key, { carrier: e.target.value })} placeholder="e.g. Omantel" />
                    </label>
                    <label className="fl" style={{ gridColumn: "1 / -1" }}>Phone numbers <span className="muted" style={{ fontWeight: 400 }}>(optional) — one per line, same order as the ICCIDs</span>
                      <textarea className="fld mono" name="phones" rows={3} value={l.phones} onChange={(e) => update(l.key, { phones: e.target.value })} />
                    </label>
                  </>
                )}
              </div>
            </section>
          ))}
          {step === 2 && (
            <button type="button" className="btn" style={{ alignSelf: "flex-start" }} onClick={() => setLines((ls) => [...ls, emptyLine()])}>Add another product</button>
          )}

          {step === 3 && (
            <section className="card" aria-label="Review">
              <div className="sh"><div><h2>Review and confirm</h2><p>Check everything once more. Nothing is saved until you confirm; then all lines are saved together, or none.</p></div></div>
              <div className="kv"><span className="k">Supplier</span><span>{supplier?.name}</span></div>
              <div className="kv"><span className="k">Received</span><span>{receivedOn} into MRD Office</span></div>
              <div className="kv"><span className="k">Paperwork</span><span className="mono">{[purchaseOrder && `PO ${purchaseOrder}`, invoiceNumber && `Invoice ${invoiceNumber}`].filter(Boolean).join(" · ") || "—"}</span></div>
              {notes && <div className="kv"><span className="k">Notes</span><span style={{ whiteSpace: "pre-line" }}>{notes}</span></div>}
              <div className="tw" style={{ borderTop: "1px solid #EEF1F4" }}>
                <table className="tbl">
                  <thead><tr><th>Product</th><th className="num">Quantity</th><th>Serial numbers</th></tr></thead>
                  <tbody>
                    {counted.map(({ l, p, serials, quantity }) => (
                      <tr key={l.key}>
                        <td>{p?.name}<div className="muted" style={{ fontSize: 12 }}>{p?.brand} {p?.model}</div></td>
                        <td className="num">{quantity}</td>
                        <td className="mono muted">{serials.length ? `${serials[0]}${serials.length > 1 ? ` … ${serials[serials.length - 1]}` : ""}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {problem && <div role="alert" className="alert warn">{problem}</div>}
          {error && step === 3 && (
            <div role="alert" className="alert err">
              <span><strong>Nothing was saved.</strong> {error} <button type="button" className="lnk" onClick={() => { setError(""); setStep(2); }}>Back to the units</button></span>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {step > 1 ? <button type="button" className="btn" onClick={() => { setProblem(""); setStep(step - 1); }}>Back</button>
                      : <Link className="btn" href="/batches">Cancel</Link>}
            <span style={{ flex: 1 }} />
            {step < 3 && <button type="button" className="btn p" onClick={next}>Next: {STEPS[step][0]} →</button>}
            {step === 3 && <button type="button" className="btn p" onClick={submit} disabled={pending}>{pending ? "Receiving…" : "Receive into MRD Office"}</button>}
          </div>

          {recent.length > 0 && (
            <section className="card">
              <div className="sh" style={{ alignItems: "center" }}><h2>Recently received</h2><Link href="/batches" style={{ fontSize: 13, fontWeight: 500 }}>All batches →</Link></div>
              {recent.map((b) => (
                <Link key={b.id} className="row" href={`/batches/${b.id}`}>
                  <span className="mono" style={{ width: 120, flex: "0 0 120px", fontSize: 12.5 }}>{b.code}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 500 }}>{b.product}{b.lines > 1 ? ` + ${b.lines - 1} more` : ""}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{b.supplier}</span>
                  </span>
                  <span style={{ textAlign: "right" }}>
                    <span style={{ display: "block", fontWeight: 600 }}>{b.quantity}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{b.receivedOn} · {b.receivedBy.split(" ")[0]}</span>
                  </span>
                </Link>
              ))}
            </section>
          )}
        </div>

        <aside style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="card" aria-label="Receipt summary">
            <div className="sh" style={{ alignItems: "center" }}><h2>Receipt summary</h2><span className="b s-unconf">Not saved yet</span></div>
            <div style={{ margin: "0 18px 12px", padding: 12, borderRadius: 10, background: "#F8FAFB", display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ width: 36, height: 36, borderRadius: 9, background: "#fff", border: "1px solid #E3E7EC", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 36px" }}>
                <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600 }}>
                  {firstProduct ? `${totalUnits} × ${firstProduct.p!.name}${counted.filter((c) => c.p).length > 1 ? ` + ${counted.filter((c) => c.p).length - 1} more` : ""}` : "No product yet"}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>{firstProduct ? `${firstProduct.p!.brand} ${firstProduct.p!.model}` : "Chosen in step 2"}</span>
              </span>
            </div>
            <div className="kv"><span className="k">Supplier</span><span>{supplier?.name ?? "—"}</span></div>
            <div className="kv"><span className="k">Batch</span><span className="mono">{supplier ? `${supplier.codePrefix}-${year}-…` : "—"}</span></div>
            <div className="kv"><span className="k">Received</span><span>{receivedOn || "—"}</span></div>
            <div className="kv"><span className="k">Into</span><span>MRD Office</span></div>
            <div className="kv"><span className="k">Serial numbers</span><span>{allSerials.length}{crossDup ? " · duplicates!" : ""}</span></div>
            <div style={{ padding: "12px 18px 16px", borderTop: "1px solid #EEF1F4", display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              {[["Shipment details", shipmentDone], ["Products and serial numbers", unitsDone && counted.some((c) => c.p)], ["Review and confirm", false]].map(([label, ok]) => (
                <span key={label as string} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 18, height: 18, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11,
                                 background: ok ? "#E1F4EC" : "#F1F4F7", color: ok ? "#0A6648" : "#8A96A8" }}>{ok ? "✓" : "·"}</span>
                  {label}<span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>{ok ? "Complete" : "Pending"}</span>
                </span>
              ))}
            </div>
          </section>
          <div className="card" style={{ padding: "14px 16px", fontSize: 13 }}>
            <span className="muted">The batch code is created when you confirm. Serial numbers that already exist are refused, and then nothing is saved.</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
