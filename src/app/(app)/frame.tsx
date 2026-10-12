"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Toaster } from "@/components/toast";
import { signOut } from "../auth-actions";

// The app's frame from the design: dark sidebar on the left, page on the right. On phones the
// sidebar is hidden and the "Menu" button opens it over the page. This part runs in the browser
// only because the menu opens and closes there; the menu items come from the server, already
// filtered by the user's permissions.

export type NavItem = { href: string; label: string; icon: IconName; count?: number };
export type NavSection = { title?: string; items: NavItem[] };
export type FrameUser = { name: string; initials: string; roleLabel: string };

export function Frame({ sections, user, topbar, children }: {
  sections: NavSection[]; user: FrameUser; topbar: ReactNode; children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="shell">
      <nav className={open ? "side open" : "side"} aria-label="Primary">
        <Link href="/" onClick={() => setOpen(false)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 8px 14px", color: "#fff" }}>
          <span style={{ width: 32, height: 32, borderRadius: 9, background: "#0B7A6B", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="logo" size={18} />
          </span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Moonrock R&amp;D</span>
            <span style={{ fontSize: 11.5, color: "#8D99AC" }}>Inventory × Exergio</span>
          </span>
        </Link>
        {sections.map((section, i) => (
          <div key={section.title ?? i} style={{ display: "contents" }}>
            {section.title && <div className="sec">{section.title}</div>}
            {section.items.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                    className={isActive(item.href) ? "nav on" : "nav"} aria-current={isActive(item.href) ? "page" : undefined}>
                <Icon name={item.icon} />
                {item.label}
                {item.count ? <span className="ct">{item.count}</span> : null}
              </Link>
            ))}
          </div>
        ))}
        <div className="who">
          <span style={{ width: 32, height: 32, borderRadius: "50%", background: "#2BC4A8", color: "#04211C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>
            {user.initials}
          </span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, flex: 1, minWidth: 0 }}>
            <span style={{ color: "#fff", fontSize: 13, fontWeight: 500 }}>{user.name}</span>
            <span style={{ color: "#8D99AC", fontSize: 11.5 }}>{user.roleLabel} · MRD Office</span>
          </span>
          <form action={signOut}>
            <button type="submit" className="btn sm" style={{ background: "#1C2A42", borderColor: "#1C2A42", color: "#fff" }}>
              Sign out
            </button>
          </form>
        </div>
      </nav>
      {open && <button aria-label="Close menu" className="ovl" style={{ zIndex: 44, border: 0 }} onClick={() => setOpen(false)} />}
      <div className="content">
        <div className="mtop" style={{ alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "#0C1424", color: "#fff" }}>
          <span style={{ fontWeight: 600 }}>Moonrock R&amp;D</span>
          <button className="btn sm" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(!open)}
                  style={{ background: "#1C2A42", borderColor: "#1C2A42", color: "#fff" }}>
            Menu
          </button>
        </div>
        {topbar}
        {children}
      </div>
      <Toaster />
    </div>
  );
}
