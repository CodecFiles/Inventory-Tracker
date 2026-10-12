"use client";

import { useState, useTransition } from "react";
import { receive } from "./actions";

// Receive a delivery: supplier and paperwork, then one line per product. Serial numbers (or ICCIDs
// for SIM cards) are pasted one per line — a barcode scanner typing into the box works too.

type Product = { id: number; name: string; brand: string; model: string; tracking: string; isSim: boolean };
type Supplier = { id: number; name: string; codePrefix: string };
type Line = { key: number; productId: string; quantity: string; serials: string; phones: string; carrier: string };

const split = (t: string) => t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
let nextKey = 1;
const emptyLine = (): Line => ({ key: nextKey++, productId: "", quantity: "", serials: "", phones: "", carrier: "" });

export function ReceiveForm({ products, suppliers, today }: { products: Product[]; suppliers: Supplier[]; today: string }) {
  const [supplierId, setSupplierId] = useState("");
  const [receivedOn, setReceivedOn] = useState(today);
  const [purchaseOrder, setPo] = useState("");
  const [invoiceNumber, setInvoice] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const byId = new Map(products.map((p) => [String(p.id), p]));
  const update = (key: number, change: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const payload = {
      supplierId: Number(supplierId),
      receivedOn,
      purchaseOrder: purchaseOrder || undefined,
      invoiceNumber: invoiceNumber || undefined,
      notes: notes || undefined,
      lines: lines.filter((l) => l.productId).map((l) => {
        const p = byId.get(l.productId)!;
        const serials = split(l.serials);
        const serialised = p.tracking === "serialised";
        return {
          productId: p.id,
          quantity: serialised ? serials.length : Number(l.quantity),
          serials: serialised ? serials : undefined,
          phoneNumbers: p.isSim && l.phones.trim() ? split(l.phones) : undefined,
          carrier: p.isSim && l.carrier.trim() ? l.carrier.trim() : undefined,
        };
      }),
    };
    startTransition(async () => {
      const result = await receive(payload);
      if (result && !result.ok) setError(result.message);
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="card">
        <div className="sh"><div><h2>Shipment details</h2><p>What arrived, from whom. It is received into MRD Office.</p></div></div>
        <div className="fgrid" style={{ padding: "0 18px 18px" }}>
          <label className="fl">Supplier
            <select className="fld" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
              <option value="" disabled>Choose…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.codePrefix})</option>)}
            </select>
          </label>
          <label className="fl">Received date<input className="fld" type="date" value={receivedOn} max={today} onChange={(e) => setReceivedOn(e.target.value)} required /></label>
          <label className="fl">Purchase order (optional)<input className="fld mono" value={purchaseOrder} onChange={(e) => setPo(e.target.value)} /></label>
          <label className="fl">Supplier invoice (optional)<input className="fld mono" value={invoiceNumber} onChange={(e) => setInvoice(e.target.value)} /></label>
          <label className="fl" style={{ gridColumn: "1 / -1" }}>Notes (optional)
            <textarea className="fld" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Condition on arrival, carton count…" />
          </label>
        </div>
      </section>

      {lines.map((l, i) => {
        const p = byId.get(l.productId);
        const serials = split(l.serials);
        const dup = serials.length !== new Set(serials).size;
        return (
          <section key={l.key} className="card">
            <div className="sh">
              <h2>Product {i + 1}</h2>
              {lines.length > 1 && (
                <button type="button" className="btn sm dg" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button>
              )}
            </div>
            <div className="fgrid" style={{ padding: "0 18px 18px" }}>
              <label className="fl">Product
                <select className="fld" value={l.productId} onChange={(e) => update(l.key, { productId: e.target.value })} required>
                  <option value="" disabled>Choose…</option>
                  {products.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.brand} {x.model}</option>)}
                </select>
              </label>
              {p && p.tracking !== "serialised" && (
                <label className="fl">Quantity received
                  <input className="fld" type="number" min={1} value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} required />
                  {p.tracking === "hybrid" && <span className="hint">Counted now; serial numbers are added later in Device preparation.</span>}
                </label>
              )}
              {p && p.tracking === "serialised" && (
                <label className="fl" style={{ gridColumn: "1 / -1" }}>
                  {p.isSim ? "ICCIDs" : "Serial numbers"} — one per line ({serials.length} entered{dup ? ", with duplicates!" : ""})
                  <textarea className="fld mono" rows={6} value={l.serials} onChange={(e) => update(l.key, { serials: e.target.value })} required
                            placeholder={p.isSim ? "89968000000012300…\n89968000000012300…" : "1108675301\n1108675302"} />
                  {p.isSim && <span className="hint">An ICCID is 18–22 digits.</span>}
                </label>
              )}
              {p?.isSim && (
                <>
                  <label className="fl">Carrier (optional)<input className="fld" value={l.carrier} onChange={(e) => update(l.key, { carrier: e.target.value })} placeholder="e.g. Omantel" /></label>
                  <label className="fl" style={{ gridColumn: "1 / -1" }}>Phone numbers (optional) — one per line, same order as the ICCIDs
                    <textarea className="fld mono" rows={3} value={l.phones} onChange={(e) => update(l.key, { phones: e.target.value })} />
                  </label>
                </>
              )}
            </div>
          </section>
        );
      })}

      {error && <div role="alert" className="alert err"><span><strong>Nothing was saved.</strong> {error}</span></div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, emptyLine()])}>Add another product</button>
        <span style={{ flex: 1 }} />
        <button type="submit" className="btn p" disabled={pending}>{pending ? "Receiving…" : "Receive into MRD Office"}</button>
      </div>
    </form>
  );
}
