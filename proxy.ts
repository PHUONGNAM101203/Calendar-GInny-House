import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

// Static files must bypass the auth gate entirely. The matcher used to exclude
// only images, so /manifest.json and /sw.js fell through to the session check,
// got redirected to /login for logged-out visitors, and the browser received a
// redirect where it expected JSON — surfacing as
// `Manifest: Line: 1, column: 1, Syntax error` in the console.
//
// Not just console noise: the landing page is public, so a logged-out visitor
// could never load the manifest and therefore could never install the PWA. On
// iOS that also takes web push down with it, since push only works from a
// home-screen-installed app (see DESIGN.md).
//
// Both files are named explicitly *and* the extension list is widened, so the
// next static asset added to public/ does not rediscover this the hard way.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json|txt|xml|webmanifest)$).*)",
  ],
};
