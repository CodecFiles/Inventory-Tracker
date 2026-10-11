import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// The link in the confirmation email (and, later, the Google sign-in return) lands here.
// It turns the one-time token into a signed-in session, then continues to the app.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const supabase = await createSupabaseServerClient();

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const { error } = tokenHash && type
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    : code
      ? await supabase.auth.exchangeCodeForSession(code)
      : { error: new Error("missing token") };

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("That link is invalid or has expired")}`);
  }
  return NextResponse.redirect(`${origin}/`);
}
