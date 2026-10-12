import Link from "next/link";
import { search, type SearchHit } from "@/server/queries/inventory";
import { requireApprovedUser } from "@/server/session";

// Search results for the top bar. Links point at the detail screens built in steps 6.2–6.4.
const KIND: Record<SearchHit["kind"], [string, (id: number) => string]> = {
  unit: ["Item", (id) => `/inventory/${id}`],
  facility: ["Facility", (id) => `/facilities/${id}`],
  deployment: ["Deployment", (id) => `/deployments/${id}`],
  shipment: ["Shipment", (id) => `/shipments/${id}`],
  batch: ["Batch", (id) => `/batches/${id}`],
};

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const user = await requireApprovedUser();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";

  let hits: SearchHit[] = [];
  let problem = "";
  if (query.length >= 2) {
    try {
      hits = await search(user.id, { q: query });
    } catch (e) {
      problem = (e as Error).message;
    }
  }

  return (
    <main className="main">
      <div>
        <div className="ov">Search</div>
        <h1 className="h1">{query ? <>Results for “{query}”</> : "Search"}</h1>
      </div>
      {problem && <div role="alert" className="alert err">{problem}</div>}
      <div className="card">
        {query.length < 2 ? (
          <div className="empty">Type at least 2 characters in the search bar: a serial, IMEI, ICCID, phone number, facility, or a DEP-/SHP-/batch code.</div>
        ) : hits.length === 0 ? (
          <div className="empty">Nothing found for “{query}”.</div>
        ) : (
          hits.map((h) => (
            <Link key={`${h.kind}-${h.id}`} href={KIND[h.kind][1](h.id)} className="row">
              <span className="b">{KIND[h.kind][0]}</span>
              <span className="mono" style={{ fontWeight: 500 }}>{h.label}</span>
              <span className="muted" style={{ marginLeft: "auto" }}>{h.detail}</span>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
