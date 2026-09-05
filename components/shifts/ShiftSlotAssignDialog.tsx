"use client";

import { useState } from "react";
import { toast } from "sonner";
import { UserPlusIcon } from "lucide-react";
import { assignShiftSlotAction } from "@/actions/shift-series";
import { formatSlotWindow } from "@/lib/shift-series";
import { isManagerRole } from "@/lib/roles";
import type { Profile, ShiftSlotDetailed } from "@/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function ShiftSlotAssignDialog({
  slot,
  branchMembers,
  open,
  onOpenChange,
}: {
  slot: ShiftSlotDetailed;
  branchMembers: Pick<
    Profile,
    "id" | "full_name" | "role" | "secondary_role" | "covers_reception" | "branch_ids"
  >[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [assigneeId, setAssigneeId] = useState("");
  const [serverError, setServerError] = useState("");
  const [pending, setPending] = useState(false);

  // Narrowed to people who actually belong to this slot's branch, so the list
  // can't offer someone the server will then refuse. Management-tier staff
  // have no profile_branches rows by design and cover every branch, and a
  // remote slot has no real branch to belong to — both stay in the list.
  const candidates = branchMembers.filter(
    (member) =>
      isManagerRole(member.role) ||
      slot.shift_type === "remote" ||
      member.branch_ids.includes(slot.branch_id)
  );

  async function onConfirm() {
    setServerError("");
    if (!assigneeId) {
      setServerError("Vui lòng chọn nhân viên");
      return;
    }
    setPending(true);
    try {
      const result = await assignShiftSlotAction({ slot_id: slot.id, assignee_id: assigneeId });
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      toast.success("Đã gán ca cho nhân viên");
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="from-primary to-primary/70 text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br">
              <UserPlusIcon className="size-4" />
            </span>
            <div>
              <DialogTitle>Gán người vào ca</DialogTitle>
              <DialogDescription>
                {formatSlotWindow(slot.start_at, slot.end_at)} · {slot.branch.name}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor={`slot_assignee_${slot.id}`}>Nhân viên</Label>
          <Select value={assigneeId} onValueChange={setAssigneeId}>
            <SelectTrigger id={`slot_assignee_${slot.id}`} className="w-full">
              <SelectValue placeholder="Chọn nhân viên" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {candidates.length === 0 && (
            <p className="text-muted-foreground text-sm">
              Không có nhân viên nào thuộc {slot.branch.name}.
            </p>
          )}
        </div>

        {serverError && <p className="text-destructive text-sm">{serverError}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button type="button" disabled={pending} onClick={onConfirm}>
            {pending ? "Đang gán..." : "Gán ca"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
