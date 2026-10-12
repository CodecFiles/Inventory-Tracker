import { NextResponse } from "next/server";
import postgres from "postgres";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Diagnostic for the database connection, for staging set-up. It shows the NON-secret parts of
// DATABASE_URL (user, host, port, database), only the *length* of the password, common mistakes,
// and the database's answer to a test query. Only signed-in users can open it.
// Visit: /api/health/db
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const raw = process.env.DATABASE_URL;
  if (!raw) return NextResponse.json({ ok: false, problem: "DATABASE_URL is not set for this deployment" });

  const checks: Record<string, unknown> = {
    lengthOfWholeValue: raw.length,
    startsOrEndsWithSpaceOrNewline: raw !== raw.trim(),
    containsQuoteMarks: /["']/.test(raw),
    containsSquareBrackets: /[[\]]/.test(raw),
  };

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return NextResponse.json({ ok: false, problem: "DATABASE_URL is not a valid address", checks });
  }
  Object.assign(checks, {
    scheme: url.protocol,
    user: decodeURIComponent(url.username),
    host: url.hostname,
    port: url.port,
    database: url.pathname.slice(1),
    passwordLength: decodeURIComponent(url.password).length,
  });

  const sql = postgres(raw.trim(), { prepare: false, max: 1, connect_timeout: 8 });
  try {
    const [row] = await sql`select current_user as "connectedAs", count(*)::int as "mrdUsers" from users`;
    return NextResponse.json({ ok: true, database: row, checks });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return NextResponse.json({ ok: false, databaseError: { code: err.code, message: err.message }, checks });
  } finally {
    await sql.end({ timeout: 2 });
  }
}
