"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Server actions for signing in, signing up and signing out. They run only on the server.
// Errors are passed back through the URL (?error=...) so the pages stay simple until Stage 6.

const Credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

export async function signIn(formData: FormData) {
  const parsed = Credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) redirect("/login?error=" + encodeURIComponent("Enter your email and password"));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // One message for every failure, so the form never reveals which emails have accounts.
  if (error) redirect("/login?error=" + encodeURIComponent("Email or password is incorrect, or the email is not confirmed yet"));
  redirect("/");
}

const SignUp = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.email().max(254),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});

export async function signUp(formData: FormData) {
  const parsed = SignUp.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    redirect("/signup?error=" + encodeURIComponent(parsed.error.issues.map((i) => i.message).join("; ")));
  }

  const origin = await siteOrigin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      // Must be a full address (https://…). A relative path would send people to a page on
      // Supabase's own domain ("requested path is invalid"). Without one, Supabase uses its Site URL.
      ...(origin ? { emailRedirectTo: `${origin}/auth/confirm` } : {}),
    },
  });
  if (error) redirect("/signup?error=" + encodeURIComponent(error.message));
  redirect("/login?message=" + encodeURIComponent("Check your email to confirm your address. An admin must then approve your account."));
}

// The public address of this site, e.g. https://inventory-tracker.vercel.app
// SITE_URL wins when set; otherwise it is worked out from the request (Vercel sends x-forwarded-*).
async function siteOrigin(): Promise<string | null> {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
  const origin = h.get("origin");
  return origin && origin.startsWith("http") ? origin : null;
}

// Google sign-in: Supabase sends the person to Google, Google sends them back to /auth/confirm.
// A first Google sign-in creates a pending account, exactly like an email sign-up (D1b).
export async function signInWithGoogle() {
  const origin = await siteOrigin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: origin ? { redirectTo: `${origin}/auth/confirm` } : {},
  });
  if (error || !data.url) {
    redirect("/login?error=" + encodeURIComponent("Google sign-in is not available right now — use your email and password"));
  }
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
