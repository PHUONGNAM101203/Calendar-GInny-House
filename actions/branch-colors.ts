"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { EVENT_COLOR_SWATCHES, isCustomHexColor } from "@/lib/calendar";
import type { ActionResult } from "@/types";

const VALID_COLORS: Set<string> = new Set(EVENT_COLOR_SWATCHES.map((c) => c.var));

function isValidColor(color: string): boolean {
  return VALID_COLORS.has(color) || isCustomHexColor(color);
}

// branchKey is either a real branches.id or the synthetic "remote" pseudo-key
// the calendar sidebar's "Cơ sở" filter uses — see 0022_branch_color_overrides.sql.
export async function updateBranchColorAction(branchKey: string, color: string): Promise<ActionResult> {
  const profile = await requireProfile();
  if (!isValidColor(color)) {
    return { ok: false, error: "Màu không hợp lệ" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("branch_color_overrides")
    .upsert({ profile_id: profile.id, branch_key: branchKey, color }, { onConflict: "profile_id,branch_key" });

  if (error) return { ok: false, error: "Không thể lưu màu cơ sở" };

  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}
