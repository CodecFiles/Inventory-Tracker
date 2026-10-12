import type { ReactNode } from "react";
import { Icon } from "@/components/icons";

// Sign-in, sign-up and "waiting for approval" pages: the design's brand panel on the left
// (design/Login.dc.html), the form card on the right.

const STEPS = [
  ["Received", "Batch"], ["Prepared", "SIM · IP"], ["POC", "Trial"], ["Contract", "Signed"],
] as const;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <section className="brand" aria-label="About MRD Inventory">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 40, height: 40, borderRadius: 11, background: "#0B7A6B", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="logo" size={20} />
          </span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
            <span style={{ fontWeight: 600, fontSize: 15.5 }}>Moonrock R&amp;D × Exergio</span>
            <span style={{ fontSize: 12.5, color: "#8D99AC" }}>Inventory &amp; Device Deployment</span>
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 560 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <span style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "#2BC4A8", fontWeight: 500 }}>
              From supplier to live facility
            </span>
            <h1 style={{ fontSize: 38, lineHeight: 1.12, fontWeight: 600, letterSpacing: "-.025em" }}>
              Every device. Every facility. Fully traceable.
            </h1>
            <p className="lite" style={{ fontSize: 15, maxWidth: 460 }}>
              Receive batches, prepare Teltonika routers with SIMs and IPs, and follow each unit through POC
              and contract deployments.
            </p>
          </div>
          <div className="hide-sm" style={{ display: "flex", flexDirection: "column", gap: 18, padding: "22px 22px 18px", borderRadius: 14, background: "rgba(21,32,54,.6)", border: "1px solid #1C2A42" }}>
            <div className="life" role="img" aria-label="Device lifecycle: Received, Prepared, POC, Contract, Active">
              {STEPS.map(([l, s]) => (
                <span key={l} style={{ display: "contents" }}>
                  <div className="nd done"><span className="c">✓</span><span className="l">{l}</span><span className="s">{s}</span></div>
                  <span className={l === "Contract" ? "lc" : "lc done"} />
                </span>
              ))}
              <div className="nd live"><span className="c">●</span><span className="l">Active</span><span className="s">Live site</span></div>
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: "#8D99AC" }}>Internal system · authorised MRD staff only</div>
      </section>
      <section style={{ flex: "1 1 460px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: "40px 20px" }}>
        {children}
      </section>
    </div>
  );
}
