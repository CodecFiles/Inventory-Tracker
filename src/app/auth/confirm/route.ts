import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// The link in the confirmation email and the Google sign-in return lands here.
// Supports Supabase's default email link (?code=...) and a custom template link (?token_hash=...).
// It turns the one-time token into a signed-in session, then continues to the app.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const supabase = await createSupabaseServerClient();

  // Google (or Supabase) reports a problem, e.g. the person pressed Cancel on Google's page
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("Sign-in was not completed: " + providerError.slice(0, 200))}`);
  }

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const { error } = tokenHash && type
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    : code
      ? await supabase.auth.exchangeCodeForSession(code)
      : { error: new Error("missing token") };

  if (error) {
    // With Supabase's default email, the address is already confirmed before the user lands here.
    // Signing in automatically only works in the browser used for sign-up, so on another device we
    // simply ask them to sign in.
    // the short code (e.g. "bad_code_verifier") says exactly what went wrong, without exposing anything
    const reason = (error as { code?: string }).code ? ` [${(error as { code?: string }).code}]` : "";
    const message = code
      ? `Please sign in. (If you just confirmed your email, that worked; if you used Google, try again from ${origin}/login.)${reason}`
      : `That link is invalid or has expired${reason}`;
    return NextResponse.redirect(`${origin}/login?message=${encodeURIComponent(message)}`);
  }
  return NextResponse.redirect(`${origin}/`);
}
