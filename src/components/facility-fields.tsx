import type { FacilityInfo } from "@/server/queries/places";

// The facility form's fields (add and edit). A facility outside Oman needs a partner in its
// country — the database refuses anything else (A6).
type Option = { id: number; name: string };

export function FacilityFields({ f, clients, countries, partners }: {
  f?: FacilityInfo; clients: Option[]; countries: (Option & { isoCode: string })[]; partners: (Option & { country: string })[];
}) {
  const oman = countries.find((c) => c.isoCode === "OM");
  return (
    <>
      <label className="fl">Facility name<input className="fld" name="name" defaultValue={f?.name} required placeholder="e.g. Lulu Bausher" /></label>
      <label className="fl">Client
        <select className="fld" name="clientId" defaultValue={f?.clientId ?? ""} required>
          <option value="" disabled>Choose…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="fl">Country
        <select className="fld" name="countryId" defaultValue={f?.countryId ?? oman?.id ?? ""} required>
          {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="fl">Partner (outside Oman)
        <select className="fld" name="partnerId" defaultValue={f?.partnerId ?? ""}>
          <option value="">None — MRD handles it</option>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.country})</option>)}
        </select>
      </label>
      <label className="fl">City<input className="fld" name="city" defaultValue={f?.city ?? ""} /></label>
      <label className="fl">Type<input className="fld" name="facilityType" defaultValue={f?.facilityType ?? ""} placeholder="e.g. Hypermarket, campus" /></label>
      <label className="fl" style={{ flexBasis: "100%" }}>Address<input className="fld" name="address" defaultValue={f?.address ?? ""} /></label>
    </>
  );
}
