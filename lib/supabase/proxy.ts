import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/", "/login", "/register"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims(), not getUser(): getUser() makes a network round-trip to the
  // auth server on EVERY request, measured at 330-814ms per authenticated
  // navigation here against 1.5ms when logged out. getClaims() verifies the
  // token's ES256 signature locally via WebCrypto and checks `exp` locally,
  // fetching the JWKS once per 10 minutes instead of once per request.
  //
  // This is not "trusting the cookie". It is a real cryptographic check, and
  // it fails safe: if the token uses a symmetric algorithm, carries no `kid`,
  // or WebCrypto is unavailable, auth-js falls back to a network getUser()
  // rather than accepting the token. Worst case is the old latency; there is
  // no path where a forged token is believed.
  //
  // A plain cookie-presence check was considered and rejected. It would have
  // been faster still, but this call is also what keeps sessions alive:
  // getClaims() → getSession() → the lazy refresh path. The Server Component
  // client cannot take over that job, because Next.js forbids writing cookies
  // during RSC render (see the swallowed error in ./server.ts). Skipping it
  // would log every user out roughly hourly and could trap a stale session in
  // a /login ↔ /calendar redirect loop.
  //
  // Note this proxy is a convenience gate, not the security boundary: every
  // page under app/(app)/ calls requireProfile()/requireManager(), and RLS is
  // enabled on all 14 tables. Independently audited 2026-08-08.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims ?? null;

  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.includes(pathname);

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  if (user && (isPublicPath || pathname === "/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/calendar";
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}
