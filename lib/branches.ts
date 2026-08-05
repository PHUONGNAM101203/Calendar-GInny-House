import { unstable_cache } from "next/cache";
import { supabasePublic } from "@/lib/supabase/public";
import type { Branch } from "@/types";

// Branches change essentially never (3 fixed locations) — cache the
// register page's lookup for an hour instead of round-tripping Supabase
// on every single page view.
export const getBranches = unstable_cache(
  async (): Promise<Branch[]> => {
    const { data } = await supabasePublic
      .from("branches")
      .select("id, code, name, address, color_token, sort_order")
      .order("sort_order");
    return (data as Branch[]) ?? [];
  },
  ["branches"],
  { revalidate: 3600, tags: ["branches"] }
);
