import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { DEV_USER_COOKIE, devPreviewUserId } from "@/lib/dev-preview";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSql, withConnection, withRetry } from "./db";

// Who is using the app right now? Identity comes from the verified Supabase login (getClaims checks
// the token's signature); status and role come from MRD's own users table.

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: "super_admin" | "admin" | "editor" | "viewer" | null;
  status: "pending" | "approved" | "rejected" | "disabled";
};

// cache(): the layout and the page both ask, but the answer is looked up once per page request.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  let userId = devPreviewUserId(process.env, (await cookies()).get(DEV_USER_COOKIE)?.value);
  if (!userId) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) return null;
    userId = data.claims.sub;
  }

  const [row] = await withConnection(() => withRetry(() => getSql()<SessionUser[]>`
    select id, email, full_name as "fullName", role::text as role, status::text as status
    from users where id = ${userId}`));
  return row ?? null;
});

// For pages that need an approved user: send everyone else to the right place.
export async function requireApprovedUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.status !== "approved") redirect("/pending");
  return user;
}

// The permissions of the signed-in user, so screens can hide what they cannot use.
// Hiding is only for convenience: every action checks the permission again on the server.
export const getPermissions = cache(async (userId: string): Promise<ReadonlySet<string>> => {
  const rows = await withConnection(() => withRetry(() => getSql()<{ key: string }[]>`
    select key from permissions where has_permission(${userId}, key)`));
  return new Set(rows.map((r) => r.key));
});

export const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin", admin: "Admin", editor: "Editor", viewer: "Viewer",
};
