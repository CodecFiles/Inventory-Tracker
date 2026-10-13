import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { getSql, withConnection, withRetry } from "@/server/db";
import { getPermissions, requireApprovedUser, ROLE_LABEL } from "@/server/session";
import { Frame } from "./frame";
import { navFor } from "./nav";

// Every signed-in page sits inside this layout: only approved users get past it.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireApprovedUser();
  const permissions = new Set(await getPermissions(user.id));   // a copy: the cached set is shared
  // corrections are a Super Admin power, not a permission that can be given (decision 0011)
  if (user.role === "super_admin") permissions.add("corrections.super_admin");
  // badge on "Device preparation": office routers still without a SIM
  const counts: Record<string, number> = {};
  if (permissions.has("inventory.prepare")) {
    const [{ n }] = await withConnection(() => withRetry(() => getSql()<{ n: number }[]>`
      select count(*)::int as n from units u join products p on p.id = u.product_id
      where p.requires_configuration and u.location_id = office_location_id() and u.status in ('in_office', 'configured')
        and not exists (select 1 from sim_assignments a where a.router_unit_id = u.id and a.ended_at is null)`));
    counts["/prep"] = n;
  }
  const initials = user.fullName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  const topbar = (
    <header className="top">
      <Form action="/search" className="srch" role="search">
        <Icon name="search" size={16} />
        <input name="q" placeholder="Search serial, IMEI, ICCID, facility, DEP/SHP code…" aria-label="Search"
               style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", font: "inherit", color: "#0E1726", outline: "none" }} />
      </Form>
      <span style={{ flex: 1 }} />
      {permissions.has("inventory.receive") && (
        <Link className="btn" href="/receive"><Icon name="receive" size={16} />Receive</Link>
      )}
      {permissions.has("deployments.create") && (
        <Link className="btn p" href="/deployments/new">
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          New deployment
        </Link>
      )}
    </header>
  );

  return (
    <Frame sections={navFor(permissions, counts)} topbar={topbar}
           user={{ name: user.fullName, initials, roleLabel: ROLE_LABEL[user.role ?? ""] ?? "" }}>
      {children}
    </Frame>
  );
}
