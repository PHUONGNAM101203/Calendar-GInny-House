import { unstable_cache } from "next/cache";
import { supabasePublic } from "@/lib/supabase/public";
import type { Branch } from "@/types";

// Branches change essentially never (3 fixed locations) — cache the
// register page's lookup for an hour instead of round-tripping Supabase
// on every single page view.
//
// Excludes the synthetic "REMOTE" row (0066_remote_branch.sql) — it's not a
// real location, so it must never show up as a pickable option in staff
// branch-membership pickers, the register page's home-branch picker, or the
// branch dropdown for non-remote shifts. Remote shifts get it auto-assigned
// server-side instead — see getRemoteBranchId() below.
export const getBranches = unstable_cache(
  async (): Promise<Branch[]> => {
    const { data } = await supabasePublic
      .from("branches")
      .select("id, code, name, address, color_token, sort_order")
      .neq("code", "REMOTE")
      .order("sort_order");
    return (data as Branch[]) ?? [];
  },
  ["branches"],
  { revalidate: 3600, tags: ["branches"] }
);

// Only called from the shift-creation Server Actions (actions/shifts.ts,
// actions/shift-requests.ts) to auto-fill branch_id when shift_type ===
// "remote" — never exposed as a user-facing option.
export const getRemoteBranchId = unstable_cache(
  async (): Promise<string> => {
    const { data } = await supabasePublic.from("branches").select("id").eq("code", "REMOTE").single();
    if (!data) throw new Error("Thiếu cơ sở Remote — chạy migration 0066_remote_branch.sql");
    return data.id;
  },
  ["remote-branch-id"],
  { revalidate: 3600, tags: ["branches"] }
);
