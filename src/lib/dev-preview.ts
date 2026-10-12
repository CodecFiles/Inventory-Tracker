// Local preview mode — for the developer's own computer only.
//
// Seeing the signed-in screens normally needs a real Supabase login. For building and checking
// screens locally against the local test database, `next dev` can act as one local test user, named
// by MRD_DEV_USER_ID. It is ignored in every production build (`next build` / `next start` set
// NODE_ENV=production) and on Vercel, so it can never open the live site.
export function devPreviewUserId(env: Record<string, string | undefined> = process.env): string | null {
  if (env.NODE_ENV !== "development" || env.VERCEL) return null;
  return env.MRD_DEV_USER_ID || null;
}
