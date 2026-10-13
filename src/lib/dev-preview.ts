// Local preview mode — for the developer's own computer only.
//
// Seeing the signed-in screens normally needs a real Supabase login. For building and checking
// screens locally against the local test database, `next dev` can act as a local demo user, named by
// MRD_DEV_USER_ID. Automated browser tests may switch demo users with the "mrd_dev_user" cookie.
// All of this is ignored in every production build (`next build` / `next start` set
// NODE_ENV=production) and on Vercel, so it can never open the live site.
export const DEV_USER_COOKIE = "mrd_dev_user";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function devPreviewUserId(env: Record<string, string | undefined> = process.env, cookie?: string): string | null {
  if (env.NODE_ENV !== "development" || env.VERCEL || !env.MRD_DEV_USER_ID) return null;
  return cookie && UUID.test(cookie) ? cookie : env.MRD_DEV_USER_ID;
}
