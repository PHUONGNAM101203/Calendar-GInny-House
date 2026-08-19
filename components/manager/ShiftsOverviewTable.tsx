"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { SearchIcon, TrashIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import TableScroller from "@/components/manager/TableScroller";
import { deleteShiftAction } from "@/actions/shifts";
import { canCreateShiftFor } from "@/lib/roles";
import { periodRange, type OverviewPeriod } from "@/lib/attendance";
import { SHIFT_TYPE_LABELS } from "@/lib/constants";
import { computeShiftKind, SHIFT_KIND_LABELS } from "@/lib/shift-kind-tag";
import type { GroupPermissions } from "@/lib/permissions";
import type { Role } from "@/types";

export type ShiftOverviewRow = {
  id: string;
  start_at: string;
  end_at: string;
  shift_type: keyof typeof SHIFT_TYPE_LABELS;
  assignee: { id: string; full_name: string; role: Role; secondary_role: Role | null };
  branch: { id: string; name: string } | null;
};

function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase();
}

// Same period-tabs-and-search shell as RequestsOverviewTable, but one row
// per shift (not aggregated counts) since the point here is picking a
// specific shift to delete, not browsing a summary.
export default function ShiftsOverviewTable({
  shifts,
  currentUserRole,
  permissions,
}: {
  shifts: ShiftOverviewRow[];
  currentUserRole: Role;
  permissions: GroupPermissions;
}) {
  const [period, setPeriod] = useState<OverviewPeriod>("month");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const { start, end } = periodRange(period, new Date());
    const query = normalizeForSearch(search.trim());
    return shifts
      .filter((s) => {
        const t = new Date(s.start_at);
        return t >= start && t <= end;
      })
      .filter((s) => !query || normalizeForSearch(s.assignee.full_name).includes(query))
      .sort((a, b) => b.start_at.localeCompare(a.start_at));
  }, [shifts, period, search]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as OverviewPeriod)}>
          <TabsList>
            <TabsTrigger value="day">Theo ngày</TabsTrigger>
            <TabsTrigger value="month">Theo tháng</TabsTrigger>
            <TabsTrigger value="year">Theo năm</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm nhân viên..."
            className="h-8 w-40 pl-8 text-sm"
          />
        </div>
      </div>

      <TableScroller visibleRows={10}>
        <table className="w-full border-collapse text-sm max-lg:block">
          <thead className="bg-muted/50 text-left text-muted-foreground max-lg:hidden">
            <tr>
              <th className="border-b border-r px-3 py-2 font-medium">Nhân viên</th>
              <th className="border-b border-r px-3 py-2 font-medium">Ngày</th>
              <th className="border-b border-r px-3 py-2 font-medium">Giờ</th>
              <th className="border-b border-r px-3 py-2 font-medium">Cơ sở</th>
              <th className="border-b border-r px-3 py-2 font-medium">Loại ca</th>
              <th className="border-b border-r px-3 py-2 font-medium">Trạng thái</th>
              <th className="border-b px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="max-lg:block">
            {rows.map((shift) => (
              <ShiftRow
                key={shift.id}
                shift={shift}
                canDelete={canCreateShiftFor(currentUserRole, shift.assignee.role, permissions)}
              />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  {search.trim() ? "Không tìm thấy ca phù hợp." : "Chưa có ca làm việc nào."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroller>
    </div>
  );
}

function ShiftRow({ shift, canDelete }: { shift: ShiftOverviewRow; canDelete: boolean }) {
  const [isPending, setIsPending] = useState(false);
  const [deleted, setDeleted] = useState(false);

  async function handleDelete() {
    setIsPending(true);
    const result = await deleteShiftAction(shift.id);
    setIsPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã xoá ca làm việc");
    setDeleted(true);
  }

  if (deleted) return null;

  const kind = computeShiftKind(shift.assignee);

  return (
    <tr className="border-t max-lg:block max-lg:space-y-1 max-lg:px-3 max-lg:py-2.5">
      <td className="border-b border-r px-3 py-2 font-medium max-lg:block max-lg:border-none max-lg:px-0 max-lg:py-0">
        {shift.assignee.full_name}
      </td>
      <td className="border-b border-r px-3 py-2 max-lg:block max-lg:border-none max-lg:px-0 max-lg:py-0 max-lg:text-xs max-lg:text-muted-foreground">
        {format(new Date(shift.start_at), "EEEE dd/MM/yyyy", { locale: vi })}
      </td>
      <td className="border-b border-r px-3 py-2 tabular-nums max-lg:block max-lg:border-none max-lg:px-0 max-lg:py-0 max-lg:text-xs max-lg:text-muted-foreground">
        {format(new Date(shift.start_at), "HH:mm")}–{format(new Date(shift.end_at), "HH:mm")}
      </td>
      <td className="border-b border-r px-3 py-2 max-lg:block max-lg:border-none max-lg:px-0 max-lg:py-0 max-lg:text-xs max-lg:text-muted-foreground">
        {shift.branch?.name ?? "—"}
      </td>
      <td className="border-b border-r px-3 py-2 max-lg:block max-lg:border-none max-lg:px-0 max-lg:py-0">
        <Badge variant="outline">{SHIFT_TYPE_LABELS[shift.shift_type]}</Badge>
      </td>
      <td className="border-b border-r px-3 py-2 max-lg:block max-lg:border-none max-lg:px-0 max-lg:py-0">
        <Badge variant="outline">{SHIFT_KIND_LABELS[kind]}</Badge>
      </td>
      <td className="border-b px-3 py-2 text-right max-lg:block max-lg:border-none max-lg:px-0 max-lg:py-0">
        {canDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="Xoá ca" disabled={isPending}>
                <TrashIcon className="size-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Xoá ca làm việc?</AlertDialogTitle>
                <AlertDialogDescription>
                  Ca của {shift.assignee.full_name} ngày{" "}
                  {format(new Date(shift.start_at), "dd/MM/yyyy")} sẽ bị xoá. Hành động này không thể hoàn
                  tác.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Huỷ</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleDelete}>
                  Xoá
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </td>
    </tr>
  );
}
