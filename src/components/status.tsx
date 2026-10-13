// Status badges in the design's colours. The database's unit lifecycle is shown with the design's
// badge names (Stage 2 revision, docs/PROJECT_STATUS.md).

const UNIT: Record<string, [string, string]> = {
  in_office: ["In stock", "s-stock"],
  configured: ["Ready", "s-ready"],
  deployed: ["Deployed", "s-deployed"],
  shipped_to_partner: ["In transit", "s-transit"],
  deployed_abroad: ["Deployed abroad", "s-deployed"],
  in_repair: ["Maintenance", "s-maint"],
  returned_to_supplier: ["Returned", "s-returned"],
  retired: ["Retired", "s-retired"],
};

// in the order of a unit's life, for filters
export const UNIT_STATUSES = Object.entries(UNIT).map(([key, [label]]) => [key, label] as const);

// the dot beside each status chip on All inventory
export const UNIT_DOT: Record<string, string> = {
  in_office: "#1A8FAD", configured: "#2F6FE4", deployed: "#12A374", shipped_to_partner: "#3346A8",
  deployed_abroad: "#0B7A6B", in_repair: "#E86A1C", returned_to_supplier: "#8A7F70", retired: "#9AA3AF",
};

export function UnitStatus({ status }: { status: string }) {
  const [label, cls] = UNIT[status] ?? [status, ""];
  return <span className={`b ${cls}`}>{label}</span>;
}

const STAGE: Record<string, [string, string]> = {
  site_inspection: ["Site inspection", "g-insp"],
  bms_scan: ["BMS scan", "g-bms"],
  poc: ["POC", "g-poc"],
  poc_study: ["POC study", "g-study"],
  contract: ["Contract", "g-contract"],
  deployment: ["Deployment", "g-cpend"],
  active_operations: ["Active operations", "g-ops"],
  closed: ["Closed", "g-done"],
};

export const stageLabel = (stage: string) => STAGE[stage]?.[0] ?? stage;

export function StageBadge({ stage }: { stage: string }) {
  const [label, cls] = STAGE[stage] ?? [stage, ""];
  return <span className={`b ${cls}`}>{label}</span>;
}

const DOC: Record<string, string> = {
  draft: "s-unconf", scheduled: "s-reserved", completed: "s-deployed", cancelled: "s-retired",
  shipped: "s-transit", received_by_partner: "s-deployed",
};

export function DocStatus({ status }: { status: string }) {
  return <span className={`b ${DOC[status] ?? ""}`}>{status.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())}</span>;
}
