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

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName }, emailRedirectTo: `${origin}/auth/confirm` },
  });
  if (error) redirect("/signup?error=" + encodeURIComponent(error.message));
  redirect("/login?message=" + encodeURIComponent("Check your email to confirm your address. An admin must then approve your account."));
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
