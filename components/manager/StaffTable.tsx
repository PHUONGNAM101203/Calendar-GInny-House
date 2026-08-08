"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelectBranches } from "@/components/ui/multi-select-branches";
import { updateStaffBranchesAction, updateStaffRoleAction } from "@/actions/staff";
import { ROLE_HIERARCHY, ROLE_LABELS, isManagerRole } from "@/lib/roles";
import type { Branch, Profile, Role } from "@/types";
import TableScroller from "@/components/manager/TableScroller";

type StaffRow = Pick<Profile, "id" | "full_name" | "phone" | "role" | "branch_ids">;

export default function StaffTable({
  staff,
  branches,
  currentUserId,
}: {
  staff: StaffRow[];
  branches: Branch[];
  currentUserId: string;
}) {
  return (
    <TableScroller visibleRows={10}>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Họ tên</th>
            <th className="px-4 py-2 font-medium">Điện thoại</th>
            <th className="px-4 py-2 font-medium">Vai trò</th>
            <th className="px-4 py-2 font-medium">Cơ sở</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((member) => (
            <tr key={member.id} className="border-t">
              <td className="px-4 py-2">
                {member.full_name}
                {member.id === currentUserId && (
                  <span className="ml-1 text-xs text-muted-foreground">(bạn)</span>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{member.phone || "—"}</td>
              <RoleAndBranchCells member={member} branches={branches} />
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

// Role and branch are edited together because they're not independent: the
// 4 manager-tier roles run every cơ sở at once, so switching a person into
// one of those roles must also clear their branch assignments — not just
// hide the picker, or a manager promoted from front-line staff would stay
// silently locked to their old branches everywhere else in the app.
function RoleAndBranchCells({
  member,
  branches,
}: {
  member: StaffRow;
  branches: Branch[];
}) {
  const [role, setRole] = useState<Role>(member.role);
  const [branchIds, setBranchIds] = useState<string[]>(member.branch_ids);
  const [isPending, startTransition] = useTransition();

  function handleRoleChange(value: string) {
    const previousRole = role;
    const next = value as Role;
    setRole(next);
    startTransition(async () => {
      const result = await updateStaffRoleAction(member.id, next);
      if (!result.ok) {
        setRole(previousRole);
        toast.error(result.error);
        return;
      }
      toast.success("Đã cập nhật vai trò");

      if (isManagerRole(next) && branchIds.length > 0) {
        const branchResult = await updateStaffBranchesAction(member.id, []);
        if (branchResult.ok) setBranchIds([]);
      }
    });
  }

  function handleBranchesChange(next: string[]) {
    const previous = branchIds;
    setBranchIds(next);
    startTransition(async () => {
      const result = await updateStaffBranchesAction(member.id, next);
      if (!result.ok) {
        setBranchIds(previous);
        toast.error(result.error);
        return;
      }
      toast.success("Đã cập nhật cơ sở");
    });
  }

  return (
    <>
      <td className="px-4 py-2">
        <Select value={role} onValueChange={handleRoleChange} disabled={isPending}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_HIERARCHY.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-4 py-2">
        {isManagerRole(role) ? (
          <span className="text-xs text-muted-foreground">Toàn hệ thống</span>
        ) : (
          <MultiSelectBranches
            branches={branches}
            value={branchIds}
            onChange={handleBranchesChange}
            disabled={isPending}
            placeholder="Chưa gán"
          />
        )}
      </td>
    </>
  );
}
