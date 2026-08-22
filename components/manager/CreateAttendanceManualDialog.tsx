"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format, parse, startOfDay } from "date-fns";
import { PlusIcon } from "lucide-react";
import { createAttendanceManualAction } from "@/actions/attendance";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { TimePickerField } from "@/components/ui/time-picker-field";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Branch, Profile } from "@/types";

const DATE_FORMAT = "yyyy-MM-dd";
const TIME_FORMAT = "HH:mm";

// Backfills a missed clock-in/out — technical only (see
// create_attendance_manual(), 0056/0060). Both times and the date are
// always required. If the employee already has an open session (from a
// shift, a free clock-in, or a correction that only fixed check-in), this
// updates that session in place rather than creating a duplicate — see
// 0060 for why.
export default function CreateAttendanceManualDialog({
  staff,
  branches,
}: {
  staff: Pick<Profile, "id" | "full_name">[];
  branches: Branch[];
}) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");
  const [profileId, setProfileId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [checkInTime, setCheckInTime] = useState("08:00");
  const [checkOutTime, setCheckOutTime] = useState("17:00");

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setServerError("");
      setProfileId("");
      setBranchId("");
      setDate(startOfDay(new Date()));
      setCheckInTime("08:00");
      setCheckOutTime("17:00");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError("");

    if (!profileId) {
      setServerError("Vui lòng chọn nhân viên");
      return;
    }
    if (!branchId) {
      setServerError("Vui lòng chọn cơ sở");
      return;
    }

    const checkIn = parse(checkInTime, TIME_FORMAT, date);
    const checkOut = parse(checkOutTime, TIME_FORMAT, date);

    setIsSubmitting(true);
    const result = await createAttendanceManualAction({
      profile_id: profileId,
      branch_id: branchId,
      check_in_at: checkIn.toISOString(),
      check_out_at: checkOut.toISOString(),
    });
    setIsSubmitting(false);

    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    // Names the date on purpose: this tool is mostly used to backfill a past
    // session, while every attendance table opens on the "Theo ngày" (today)
    // tab. A bare success message left people staring at a table filtered to
    // a different day, concluding nothing had been created — and creating it
    // again, which is how a duplicate pair reached production on 2026-08-22.
    toast.success(`Đã tạo chấm công thủ công cho ${format(date, "dd/MM/yyyy")}`);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {/* Filled, not outline — this is the section's own create action, the
            same role "Tạo ca cố định" plays in ShiftSeriesSection, so the two
            section headers on /manager read as one pattern. Keep them in sync. */}
        <Button type="button" size="sm">
          <PlusIcon className="size-4" />
          Tạo chấm công thủ công
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tạo chấm công thủ công</DialogTitle>
          <DialogDescription>
            Dùng khi nhân viên quên chấm công cho phiên làm việc tự do (trợ giảng, không gắn ca).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="manual_profile_id">Nhân viên</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger id="manual_profile_id" className="w-full">
                <SelectValue placeholder="Chọn nhân viên" />
              </SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="manual_branch_id">Cơ sở</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger id="manual_branch_id" className="w-full">
                <SelectValue placeholder="Chọn cơ sở" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <DatePickerField
              id="manual_date"
              label="Ngày"
              value={format(date, DATE_FORMAT)}
              onChange={(value) => setDate(parse(value, DATE_FORMAT, new Date()))}
            />
            <div className="grid grid-cols-2 gap-3">
              <TimePickerField id="manual_check_in" label="Giờ vào" value={checkInTime} onChange={setCheckInTime} />
              <TimePickerField id="manual_check_out" label="Giờ ra" value={checkOutTime} onChange={setCheckOutTime} />
            </div>
          </div>

          {serverError && <p className="text-sm text-destructive">{serverError}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Đang lưu..." : "Lưu"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
