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
import {
  updateStaffBranchesAction,
  updateStaffRoleAction,
  updateStaffSecondaryRoleAction,
  updateStaffCoversReceptionAction,
  deactivateStaffAction,
} from "@/actions/staff";
import {
  ROLE_HIERARCHY,
  ROLE_LABELS,
  SECONDARY_ROLE_BY_PRIMARY,
  SECONDARY_ROLE_ELIGIBLE_ROLES,
  canCoverReception,
  isManagerRole,
} from "@/lib/roles";
import type { Branch, Profile, Role } from "@/types";
import TableScroller from "@/components/manager/TableScroller";

type StaffRow = Pick<
  Profile,
  | "id"
  | "full_name"
  | "phone"
  | "role"
  | "secondary_role"
  | "covers_reception"
  | "branch_ids"
  | "deactivated_at"
>;

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
      <table className="w-full text-sm max-lg:block">
        <thead className="bg-muted/50 text-left text-muted-foreground max-lg:hidden">
          <tr>
            <th className="px-4 py-2 font-medium">Họ tên</th>
            <th className="px-4 py-2 font-medium">Điện thoại</th>
            <th className="px-4 py-2 font-medium">Vai trò</th>
            <th className="px-4 py-2 font-medium">Cơ sở</th>
            {canDeactivate && <th className="px-4 py-2 font-medium">Trạng thái</th>}
          </tr>
        </thead>
        <tbody className="max-lg:block">
          {staff.map((member) => (
            <tr key={member.id} className="border-t max-lg:block max-lg:space-y-2 max-lg:px-4 max-lg:py-3">
              <td className="px-4 py-2 font-medium max-lg:block max-lg:px-0 max-lg:py-0">
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
                  <span className="block text-xs font-normal text-muted-foreground lg:hidden">
                    {member.phone}
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground max-lg:hidden">{member.phone || "—"}</td>
              <RoleAndBranchCells member={member} branches={branches} />
              {canDeactivate && (
                <td className="px-4 py-2 max-lg:block max-lg:px-0 max-lg:py-0">
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
  const [secondaryRole, setSecondaryRole] = useState<Role | null>(member.secondary_role);
  const [coversReception, setCoversReception] = useState(member.covers_reception);
  const [branchIds, setBranchIds] = useState<string[]>(member.branch_ids);
  const [isPending, startTransition] = useTransition();

  function handleRoleChange(value: string) {
    const previousRole = role;
    const next = value as Role;
    setRole(next);
    // Optimistic mirror of the DB auto-clear trigger (0051) — avoids a
    // checked box lingering for a pairing that's about to become invalid.
    if (secondaryRole && !SECONDARY_ROLE_ELIGIBLE_ROLES.has(next)) setSecondaryRole(null);
    // Same optimistic mirror for kiêm lễ tân — protect_profile_privileges
    // (0085) clears it server-side when the new role cannot cover reception.
    if (coversReception && !canCoverReception(next)) setCoversReception(false);
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

  function handleSecondaryRoleChange(checked: boolean) {
    const previous = secondaryRole;
    const next = checked ? (SECONDARY_ROLE_BY_PRIMARY[role] ?? null) : null;
    setSecondaryRole(next);
    startTransition(async () => {
      const result = await updateStaffSecondaryRoleAction(member.id, next);
      if (!result.ok) {
        setSecondaryRole(previous);
        toast.error(result.error);
        return;
      }
      toast.success(checked ? "Đã thêm vai trò kiêm nhiệm" : "Đã bỏ vai trò kiêm nhiệm");
    });
  }

  function handleCoversReceptionChange(checked: boolean) {
    const previous = coversReception;
    setCoversReception(checked);
    startTransition(async () => {
      const result = await updateStaffCoversReceptionAction(member.id, checked);
      if (!result.ok) {
        setCoversReception(previous);
        toast.error(result.error);
        return;
      }
      toast.success(checked ? "Đã thêm kiêm lễ tân" : "Đã bỏ kiêm lễ tân");
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
      <td className="px-4 py-2 max-lg:block max-lg:px-0 max-lg:py-0">
        <Select value={role} onValueChange={handleRoleChange} disabled={isPending}>
          <SelectTrigger size="sm" className="w-44 max-lg:w-full">
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
        {SECONDARY_ROLE_ELIGIBLE_ROLES.has(role) && (
          <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-input"
              checked={secondaryRole === SECONDARY_ROLE_BY_PRIMARY[role]}
              disabled={isPending}
              onChange={(e) => handleSecondaryRoleChange(e.target.checked)}
            />
            Kiêm {ROLE_LABELS[SECONDARY_ROLE_BY_PRIMARY[role]!]}
          </label>
        )}
        {/* Ô tick riêng, không phải một giá trị của ô trên: một quản sinh có
            thể vừa kiêm trợ giảng vừa kiêm lễ tân — ba vai trò. Đó chính là lý
            do covers_reception là cột riêng chứ không nhét vào secondary_role. */}
        {canCoverReception(role) && (
          <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-input"
              checked={coversReception}
              disabled={isPending}
              onChange={(e) => handleCoversReceptionChange(e.target.checked)}
            />
            Kiêm {ROLE_LABELS.receptionist}
          </label>
        )}
      </td>
      <td className="px-4 py-2 max-lg:block max-lg:px-0 max-lg:py-0">
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
