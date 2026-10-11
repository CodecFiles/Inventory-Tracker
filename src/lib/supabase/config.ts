// Supabase connection settings, read from environment variables.
// The publishable key is designed to be public (it only allows what Supabase Auth allows), so it may
// be used in browser code. The database connection string (DATABASE_URL) is NOT public and is only
// used by server code in src/server/.

export function supabaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  // accept "abc.supabase.co" as well as "https://abc.supabase.co"
  return (raw.startsWith("http") ? raw : `https://${raw}`).replace(/\/$/, "");
}

export function supabasePublishableKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error("SUPABASE_PUBLISHABLE_KEY is not set");
  return key;
}
