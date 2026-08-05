import { createClient } from "@supabase/supabase-js";

// Anon client with no cookie binding, for data that's public (RLS-open to
// `anon`) and doesn't depend on the current request — safe to use from
// cached helpers like unstable_cache, unlike lib/supabase/server.ts which
// is tied to the request's cookies and can't be cached across requests.
export const supabasePublic = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
