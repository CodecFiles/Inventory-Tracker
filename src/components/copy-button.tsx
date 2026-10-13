"use client";

import { useState } from "react";

// Copies a value (serial, ICCID, IP…) to the clipboard, as on the design's item page.
export function CopyButton({ value, label, text }: { value: string; label: string; text?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={text ? "btn sm" : "cpy"} aria-label={`Copy ${label}`} title={`Copy ${label}`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value);
                setDone(true);
                setTimeout(() => setDone(false), 1500);
              } catch { /* clipboard blocked: nothing to do */ }
            }}>
      <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {done ? <path d="M5 12l5 5 9-10" /> : <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></>}
      </svg>
      {text && (done ? "Copied" : "Copy")}
    </button>
  );
}
