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
//
// /api/ is also excluded — the app's first (and so far only) route lives at
// /api/cron/attendance-reminders (0056), called by Vercel Cron with a Bearer
// secret and no Supabase session cookie at all. Left in the matcher, this
// gate would redirect that unauthenticated request to /login before the
// route handler's own auth check ever ran, silently breaking the cron job.
// API routes are expected to do their own auth, same as this one does.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json|txt|xml|webmanifest)$).*)",
  ],
};
