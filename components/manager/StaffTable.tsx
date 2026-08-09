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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { updateStaffBranchesAction, updateStaffRoleAction, deactivateStaffAction } from "@/actions/staff";
import { ROLE_HIERARCHY, ROLE_LABELS, isManagerRole } from "@/lib/roles";
import type { Branch, Profile, Role } from "@/types";
import TableScroller from "@/components/manager/TableScroller";

type StaffRow = Pick<Profile, "id" | "full_name" | "phone" | "role" | "branch_ids" | "deactivated_at">;

export default function StaffTable({
  staff,
  branches,
  currentUserId,
  currentUserRole,
}: {
  staff: StaffRow[];
  branches: Branch[];
  currentUserId: string;
  currentUserRole: Role;
}) {
  const canDeactivate = currentUserRole === "technical";

  return (
    <TableScroller visibleRows={10}>
      <table className="w-full text-sm max-sm:block">
        <thead className="bg-muted/50 text-left text-muted-foreground max-sm:hidden">
          <tr>
            <th className="px-4 py-2 font-medium">Họ tên</th>
            <th className="px-4 py-2 font-medium">Điện thoại</th>
            <th className="px-4 py-2 font-medium">Vai trò</th>
            <th className="px-4 py-2 font-medium">Cơ sở</th>
            {canDeactivate && <th className="px-4 py-2 font-medium">Trạng thái</th>}
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {staff.map((member) => (
            <tr key={member.id} className="border-t max-sm:block max-sm:space-y-2 max-sm:px-4 max-sm:py-3">
              <td className="px-4 py-2 font-medium max-sm:block max-sm:px-0 max-sm:py-0">
                {member.full_name}
                {member.id === currentUserId && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">(bạn)</span>
                )}
                {member.deactivated_at && (
                  <Badge variant="outline" className="ml-2 align-middle">
                    Đã vô hiệu hoá
                  </Badge>
                )}
                {/* Số điện thoại chui xuống dưới tên khi cột riêng bị ẩn. */}
                {member.phone && (
                  <span className="block text-xs font-normal text-muted-foreground sm:hidden">
                    {member.phone}
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground max-sm:hidden">{member.phone || "—"}</td>
              <RoleAndBranchCells member={member} branches={branches} />
              {canDeactivate && (
                <td className="px-4 py-2 max-sm:block max-sm:px-0 max-sm:py-0">
                  {member.id === currentUserId ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <DeactivateButton member={member} />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

// Deactivation is reversible, so the confirm copy and button label both
// switch based on current state — this doubles as the reactivate control.
function DeactivateButton({ member }: { member: StaffRow }) {
  const [deactivatedAt, setDeactivatedAt] = useState(member.deactivated_at);
  const [isPending, startTransition] = useTransition();
  const isDeactivated = Boolean(deactivatedAt);

  function handleConfirm() {
    const next = !isDeactivated;
    startTransition(async () => {
      const result = await deactivateStaffAction(member.id, next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDeactivatedAt(next ? new Date().toISOString() : null);
      toast.success(next ? "Đã vô hiệu hoá tài khoản" : "Đã kích hoạt lại tài khoản");
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={isPending}>
          {isDeactivated ? "Kích hoạt lại" : "Vô hiệu hoá"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isDeactivated ? "Kích hoạt lại tài khoản?" : "Vô hiệu hoá tài khoản?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isDeactivated
              ? `${member.full_name} sẽ đăng nhập lại được như bình thường.`
              : `${member.full_name} sẽ không đăng nhập được nữa. Toàn bộ ca làm, đơn từ và chấm công cũ vẫn được giữ nguyên — có thể kích hoạt lại bất cứ lúc nào.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          <AlertDialogAction
            variant={isDeactivated ? "default" : "destructive"}
            disabled={isPending}
            onClick={handleConfirm}
          >
            {isDeactivated ? "Kích hoạt lại" : "Vô hiệu hoá"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
      <td className="px-4 py-2 max-sm:block max-sm:px-0 max-sm:py-0">
        <Select value={role} onValueChange={handleRoleChange} disabled={isPending}>
          <SelectTrigger size="sm" className="w-44 max-sm:w-full">
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
      <td className="px-4 py-2 max-sm:block max-sm:px-0 max-sm:py-0">
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
