import "server-only";

// Reading HTML form fields: an empty box means "not given". Every value is checked again by the
// server function's own validation (zod) — these helpers only convert text to the right type.
export const text = (f: FormData, key: string) => {
  const v = f.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
export const num = (f: FormData, key: string) => {
  const v = text(f, key);
  return v === undefined ? undefined : Number(v);
};
export const checked = (f: FormData, key: string) => f.get(key) === "on";
// one value per line (e.g. serial numbers pasted from a scanner); blank lines ignored
export const lines = (f: FormData, key: string) =>
  (text(f, key) ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
