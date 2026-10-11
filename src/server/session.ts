import "server-only";
import { redirect } from "next/navigation";
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
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return null;

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
