import type { NavSection } from "./frame";

// The sidebar, grouped like the design. Each item names the permission needed to see it; screens
// are added here as they are built in Stage 6.
type Item = NavSection["items"][number] & { permission: string };

const NAV: { title?: string; items: Item[] }[] = [
  { items: [{ href: "/", label: "Dashboard", icon: "dashboard", permission: "reports.view" }] },
  { title: "Insights & admin", items: [
    { href: "/admin/users", label: "Users & roles", icon: "users", permission: "users.approve" },
  ] },
];

export function navFor(permissions: Set<string>, counts: Record<string, number> = {}): NavSection[] {
  return NAV
    .map((s) => ({
      title: s.title,
      items: s.items
        .filter((i) => permissions.has(i.permission))
        .map((i) => ({ href: i.href, label: i.label, icon: i.icon, count: counts[i.href] })),
    }))
    .filter((s) => s.items.length > 0);
}
