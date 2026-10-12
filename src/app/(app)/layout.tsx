import Form from "next/form";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { getSql } from "@/server/db";
import { getPermissions, requireApprovedUser, ROLE_LABEL } from "@/server/session";
import { Frame } from "./frame";
import { navFor } from "./nav";

// Every signed-in page sits inside this layout: only approved users get past it.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireApprovedUser();
  const permissions = await getPermissions(user.id);
  // badge on "Device preparation": office routers still without a SIM
  const counts: Record<string, number> = {};
  if (permissions.has("inventory.prepare")) {
    const [{ n }] = await getSql()<{ n: number }[]>`
      select count(*)::int as n from units u join products p on p.id = u.product_id
      where p.requires_configuration and u.location_id = office_location_id() and u.status in ('in_office', 'configured')
        and not exists (select 1 from sim_assignments a where a.router_unit_id = u.id and a.ended_at is null)`;
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
    </header>
  );

  return (
    <Frame sections={navFor(permissions, counts)} topbar={topbar}
           user={{ name: user.fullName, initials, roleLabel: ROLE_LABEL[user.role ?? ""] ?? "" }}>
      {children}
    </Frame>
  );
}
