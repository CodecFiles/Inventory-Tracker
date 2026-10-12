import "server-only";
import { redirect } from "next/navigation";
import { devPreviewUserId } from "@/lib/dev-preview";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSql } from "./db";

// Who is using the app right now? Identity comes from the verified Supabase login (getClaims checks
// the token's signature); status and role come from MRD's own users table.

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: "super_admin" | "admin" | "editor" | "viewer" | null;
  status: "pending" | "approved" | "rejected" | "disabled";
};

export async function getSessionUser(): Promise<SessionUser | null> {
  let userId = devPreviewUserId();
  if (!userId) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) return null;
    userId = data.claims.sub;
  }

  const [row] = await getSql()<SessionUser[]>`
    select id, email, full_name as "fullName", role::text as role, status::text as status
    from users where id = ${userId}`;
  return row ?? null;
}

// For pages that need an approved user: send everyone else to the right place.
export async function requireApprovedUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.status !== "approved") redirect("/pending");
  return user;
}

// The permissions of the signed-in user, so screens can hide what they cannot use.
// Hiding is only for convenience: every action checks the permission again on the server.
export async function getPermissions(userId: string): Promise<Set<string>> {
  const rows = await getSql()<{ key: string }[]>`
    select key from permissions where has_permission(${userId}, key)`;
  return new Set(rows.map((r) => r.key));
}

export const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin", admin: "Admin", editor: "Editor", viewer: "Viewer",
};
