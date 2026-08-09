import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Route Handler, not a call inside requireProfile() itself — Next.js
// forbids writing response cookies during Server Component render (see the
// swallowed error in lib/supabase/server.ts), so signOut()'s cookie clear
// silently no-ops there and the redirect to /login bounces straight back to
// /calendar via proxy.ts's "authenticated user hitting /login" rule,
// looping forever. Route Handlers run a full request/response cycle, same
// as Server Actions, so the cookie clear here actually reaches the browser.
export async function GET() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
