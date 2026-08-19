"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceDot,
  Label,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import BrandMark from "@/components/brand/BrandMark";
import StaffOverviewTable from "@/components/manager/StaffOverviewTable";
import RequestsOverviewTable from "@/components/manager/RequestsOverviewTable";
import { aggregateHoursByDay } from "@/lib/attendance";
import { cn } from "@/lib/utils";
import type {
  Attendance,
  AttendanceCorrectionDetailed,
  LeaveRequestDetailed,
  Profile,
  ShiftRequestDetailed,
  SwapRequestDetailed,
} from "@/types";

/* Băng điều hành — một tấm panel navy duy nhất thay cho 5 card rời rạc.
   Trên nền tối, con số nào cần hành động thì tự phát sáng (vàng = chờ
   duyệt, teal = đang diễn ra) — người quản lý đọc được "hôm nay cần làm
   gì" trước cả khi đọc nhãn. Dark mode chuyển về card thường vì --primary
   ở dark là xanh sáng, chữ vàng trên đó sẽ mất tương phản. */
function BandStat({
  label,
  value,
  tone = "ink",
  live = false,
}: {
  label: string;
  value: number;
  tone?: "ink" | "gold" | "success";
  live?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[10px] font-extrabold tracking-wider text-primary-foreground/60 uppercase dark:text-muted-foreground">
        {live && value > 0 && (
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-1.5 rounded-full bg-success" />
          </span>
        )}
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 font-heading text-4xl leading-none font-semibold tracking-tight tabular-nums",
          tone === "gold" && value > 0
            ? "text-gold"
            : tone === "success" && value > 0
              ? // --success (L 0.55) chìm trên nền navy — sáng hoá riêng cho băng
                // light mode; dark mode nền là card tối nên token gốc đủ tương phản.
                "text-[oklch(0.78_0.1_165)] dark:text-success"
              : "text-primary-foreground dark:text-foreground"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function QueueRow({
  href,
  label,
  value,
  tone,
}: {
  href: string;
  label: string;
  value: number;
  tone: "gold" | "success" | "muted";
}) {
  const active = value > 0;
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center justify-between gap-3 rounded-lg border px-3.5 py-3 transition-colors",
        active && tone === "gold"
          ? "border-gold/40 bg-gold/10 hover:bg-gold/15"
          : active && tone === "success"
            ? "border-success/30 bg-success/8 hover:bg-success/12"
            : "hover:bg-accent"
      )}
    >
      <span className="flex items-center gap-2.5 text-sm font-medium">
        <span
          className={cn(
            "size-2 rounded-full",
            active && tone === "gold"
              ? "bg-gold"
              : active && tone === "success"
                ? "bg-success"
                : "bg-border"
          )}
        />
        {label}
      </span>
      <span className="flex items-center gap-2">
        <span className="font-heading text-xl font-semibold tabular-nums">{value}</span>
        <ArrowRightIcon className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
    </Link>
  );
}

export default function ManagerDashboard({
  totalStaff,
  unassignedStaff,
  shiftsToday,
  pendingSwaps,
  pendingLeave,
  pendingShiftRequests,
  pendingAttendanceCorrections,
  clockedInCount,
  staff,
  attendance,
  leaveRequests,
  swapRequests,
  shiftRequests,
  attendanceCorrections,
  overviewTitle,
}: {
  totalStaff: number;
  unassignedStaff: number;
  shiftsToday: number;
  pendingSwaps: number;
  pendingLeave: number;
  pendingShiftRequests: number;
  pendingAttendanceCorrections: number;
  clockedInCount: number;
  staff: Pick<Profile, "id" | "full_name" | "role" | "secondary_role">[];
  attendance: Attendance[];
  leaveRequests: LeaveRequestDetailed[];
  swapRequests: SwapRequestDetailed[];
  shiftRequests: ShiftRequestDetailed[];
  attendanceCorrections: AttendanceCorrectionDetailed[];
  overviewTitle?: string;
}) {
  const hoursByDay = useMemo(() => aggregateHoursByDay(attendance, 7), [attendance]);
  const peakDay = useMemo(
    () => hoursByDay.reduce((max, d) => (d.hours > max.hours ? d : max), hoursByDay[0]),
    [hoursByDay]
  );
  const totalWeekHours = useMemo(
    () => Math.round(hoursByDay.reduce((sum, d) => sum + d.hours, 0) * 10) / 10,
    [hoursByDay]
  );
  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("vi-VN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(new Date()),
    []
  );
  const needsAttention = pendingSwaps + pendingLeave + pendingShiftRequests + pendingAttendanceCorrections;

  return (
    <div className="space-y-6">
      {/* Băng điều hành */}
      <div className="relative overflow-hidden rounded-2xl bg-primary text-primary-foreground dark:border dark:bg-card dark:text-card-foreground">
        <BrandMark
          variant="white"
          className="pointer-events-none absolute -top-10 -right-14 size-56 opacity-[0.06] dark:opacity-[0.04]"
        />
        <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(180px,1fr)_auto] lg:items-end">
          <div>
            <p className="text-[10px] font-extrabold tracking-[0.16em] text-primary-foreground/60 uppercase dark:text-muted-foreground">
              Bảng điều hành
            </p>
            <p
              className="mt-1.5 font-heading text-2xl font-semibold tracking-tight capitalize"
              suppressHydrationWarning
            >
              {todayLabel}
            </p>
            <p className="mt-1 text-xs text-primary-foreground/65 dark:text-muted-foreground">
              {needsAttention > 0
                ? `${needsAttention} yêu cầu đang chờ bạn duyệt.`
                : "Không có yêu cầu nào chờ duyệt — mọi thứ đang gọn."}
              {unassignedStaff > 0 && ` · ${unassignedStaff} người chưa gán cơ sở`}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-5 lg:flex lg:items-end lg:gap-10">
            <BandStat label="Nhân viên" value={totalStaff} />
            <BandStat label="Ca hôm nay" value={shiftsToday} />
            <BandStat label="Chờ đổi ca" value={pendingSwaps} tone="gold" />
            <BandStat label="Chờ duyệt nghỉ" value={pendingLeave} tone="gold" />
            <BandStat label="Đang trong ca" value={clockedInCount} tone="success" live />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardContent>
            <div className="mb-1 flex items-baseline justify-between">
              <h3 className="font-heading text-base font-semibold">Giờ làm 7 ngày qua</h3>
              <p className="text-xs text-muted-foreground">
                Tổng <span className="font-semibold text-foreground">{totalWeekHours} giờ</span>
              </p>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hoursByDay} margin={{ top: 28, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="hoursFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--calendar-grid)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    width={28}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value) => [`${value} giờ`, "Tổng giờ làm"]}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-md)",
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="hours"
                    stroke="var(--primary)"
                    strokeWidth={2.5}
                    fill="url(#hoursFill)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  {peakDay.hours > 0 && (
                    <ReferenceDot
                      x={peakDay.label}
                      y={peakDay.hours}
                      r={4}
                      fill="var(--primary)"
                      stroke="var(--card)"
                      strokeWidth={2}
                    >
                      <Label
                        value={`${peakDay.hours} giờ`}
                        position="top"
                        offset={10}
                        style={{ fill: "var(--foreground)", fontSize: 12, fontWeight: 600 }}
                      />
                    </ReferenceDot>
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Hàng đợi việc cần làm — thay cho biểu đồ cột cũ vốn chỉ vẽ lại
            đúng 4 con số đã hiện ở băng trên. Mỗi dòng bấm được, dẫn thẳng
            xuống khu vực xử lý tương ứng. */}
        <Card className="lg:col-span-2">
          <CardContent className="flex h-full flex-col">
            <h3 className="mb-3 font-heading text-base font-semibold">Cần xử lý</h3>
            <div className="flex flex-1 flex-col justify-center gap-2">
              <QueueRow href="#swaps" label="Yêu cầu đổi ca" value={pendingSwaps} tone="gold" />
              <QueueRow href="#leave" label="Đơn nghỉ phép" value={pendingLeave} tone="gold" />
              <QueueRow href="#shift-requests" label="Đăng ký ca" value={pendingShiftRequests} tone="gold" />
              <QueueRow
                href="#attendance-corrections"
                label="Giải trình công"
                value={pendingAttendanceCorrections}
                tone="gold"
              />
              <QueueRow href="#staff" label="Đang trong ca" value={clockedInCount} tone="success" />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {needsAttention === 0
                ? "Hàng đợi trống — không có đơn nào chờ duyệt."
                : "Bấm vào một dòng để đi thẳng tới khu vực duyệt."}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent>
          <StaffOverviewTable
            title={overviewTitle}
            staff={staff}
            attendance={attendance}
            leaveRequests={leaveRequests}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <RequestsOverviewTable
            staff={staff}
            leaveRequests={leaveRequests}
            swapRequests={swapRequests}
            shiftRequests={shiftRequests}
            attendanceCorrections={attendanceCorrections}
            canRevert={false}
          />
        </CardContent>
      </Card>
    </div>
  );
}
