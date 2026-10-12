import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { devPreviewUserId } from "@/lib/dev-preview";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/config";

// Runs before every page. It keeps the login session fresh (Supabase tokens expire and are renewed
// here) and sends signed-out visitors to the login page. It is a convenience layer only: every page
// and server action still checks the user itself (src/server/session.ts).

const PUBLIC_PATHS = ["/login", "/signup", "/auth"];

export async function proxy(request: NextRequest) {
  // One address for the live site. Vercel also serves each deployment on its own address
  // (inventory-xxxx-mrd23.vercel.app); signing in there breaks, because the login cookies belong to
  // whichever address you started on, while Google and email links always return to SITE_URL.
  const site = process.env.SITE_URL;
  if (site && process.env.VERCEL_ENV === "production") {
    const canonical = new URL(site);
    if (request.nextUrl.host !== canonical.host) {
      const url = request.nextUrl.clone();
      url.protocol = canonical.protocol;
      url.host = canonical.host;
      url.port = "";
      return NextResponse.redirect(url, 308);
    }
  }

  // local preview mode (never in production): skip the Supabase session
  if (devPreviewUserId()) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // everything except Next.js internals and static files
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
