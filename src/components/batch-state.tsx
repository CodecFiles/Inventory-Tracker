import type { StateCounts } from "@/server/queries/batches";

// Where a batch's units are now, as one coloured bar (Batches list and Batch detail).
export const STATE_PARTS = [
  ["inStock", "In stock", "#8A96A8"],
  ["ready", "Ready", "#2F6FE4"],
  ["deployed", "Deployed", "#12A374"],
  ["partners", "With partners", "#3346A8"],
  ["repair", "In repair", "#E08A00"],
  ["gone", "Written off / returned", "#C9CFD8"],
] as const;

export function StateBar({ s, height = 6 }: { s: StateCounts; height?: number }) {
  return (
    <div className="seg" style={{ height, background: "#EEF1F4" }} role="img"
         aria-label={STATE_PARTS.filter(([k]) => s[k] > 0).map(([k, label]) => `${s[k]} ${label.toLowerCase()}`).join(", ") || "no units"}>
      {STATE_PARTS.map(([k, label, color]) => s[k] > 0 && (
        <span key={k} style={{ width: `${(s[k] / s.units) * 100}%`, background: color }} title={`${label} · ${s[k]}`} />
      ))}
    </div>
  );
}
