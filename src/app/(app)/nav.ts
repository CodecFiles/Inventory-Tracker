import type { NavSection } from "./frame";

// The sidebar, grouped like the design. Each item names the permission(s) needed to see it (any one
// is enough); screens are added here as they are built in Stage 6.
type Item = NavSection["items"][number] & { permission: string | string[] };

const NAV: { title?: string; items: Item[] }[] = [
  { items: [{ href: "/", label: "Dashboard", icon: "dashboard", permission: "reports.view" }] },
  { title: "Inventory", items: [
    { href: "/inventory", label: "All inventory", icon: "inventory", permission: "reports.view" },
    { href: "/batches", label: "Batches", icon: "batches", permission: "reports.view" },
    { href: "/receive", label: "Receive stock", icon: "receive", permission: "inventory.receive" },
  ] },
  { title: "Devices", items: [
    { href: "/prep", label: "Device preparation", icon: "prep", permission: "inventory.prepare" },
    { href: "/sims", label: "SIM cards", icon: "sim", permission: "reports.view" },
  ] },
  { title: "Insights & admin", items: [
    { href: "/admin/users", label: "Users & roles", icon: "users", permission: "users.approve" },
    { href: "/settings", label: "Settings", icon: "settings", permission: ["products.manage", "suppliers.manage"] },
  ] },
];

export function navFor(permissions: Set<string>, counts: Record<string, number> = {}): NavSection[] {
  return NAV
    .map((s) => ({
      title: s.title,
      items: s.items
        .filter((i) => [i.permission].flat().some((p) => permissions.has(p)))
        .map((i) => ({ href: i.href, label: i.label, icon: i.icon, count: counts[i.href] })),
    }))
    .filter((s) => s.items.length > 0);
}
