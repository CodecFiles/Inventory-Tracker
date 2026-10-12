import { NextResponse } from "next/server";
import postgres from "postgres";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { databaseUrl } from "@/server/db";

// Diagnostic for the database connection, for staging set-up. It shows the NON-secret parts of
// the database address (DATABASE_URL or POSTGRES_URL) (user, host, port, database), only the *length* of the password, common mistakes,
// and the database's answer to a test query. Only signed-in users can open it.
// Visit: /api/health/db
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const source = process.env.DATABASE_URL ? "DATABASE_URL" : process.env.POSTGRES_URL ? "POSTGRES_URL" : null;
  const raw = databaseUrl();
  if (!raw) {
    return NextResponse.json({ ok: false, problem: "Neither DATABASE_URL nor POSTGRES_URL is set for this deployment" });
  }

  const original = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";
  const checks: Record<string, unknown> = {
    source,
    lengthOfWholeValue: original.length,
    startsOrEndsWithSpaceOrNewline: original !== original.trim(),
    containsQuoteMarks: /["']/.test(original),
    containsSquareBrackets: /[[\]]/.test(original),
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
