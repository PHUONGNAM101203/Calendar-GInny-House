"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PlusIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { format, parse } from "date-fns";
import { vi } from "date-fns/locale";
import { deleteHolidayAction } from "@/actions/holidays";
import type { Holiday } from "@/types";
import HolidayFormDialog from "@/components/manager/HolidayFormDialog";
import CollapsibleGrid from "@/components/manager/CollapsibleGrid";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

export default function HolidaysSection({ holidays }: { holidays: Holiday[] }) {
  const [createOpen, setCreateOpen] = useState(false);
  // Keyed by id below, so reopening for a different row remounts the form
  // rather than showing the previous holiday's values.
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function onDelete(holiday: Holiday) {
    setDeletingId(holiday.id);
    try {
      const result = await deleteHolidayAction(holiday.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Đã xoá ngày lễ");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Ngày lễ chỉ hiển thị trên lịch. Sửa ở đây là lịch của mọi người đổi theo ngay.
        </p>
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-4" />
          Thêm ngày lễ
        </Button>
      </div>

      {holidays.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Chưa có ngày lễ nào. Thêm một ngày để nó hiện lên lịch của cả trung tâm.
        </p>
      ) : (
        <CollapsibleGrid className="grid gap-2 lg:grid-cols-2">
          {holidays.map((holiday) => (
            <Card key={holiday.id}>
              <CardContent className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate font-medium">{holiday.name}</p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {describeRange(holiday)}
                  </p>
                  {holiday.note && (
                    <p className="text-muted-foreground text-xs">{holiday.note}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Sửa ${holiday.name}`}
                    onClick={() => setEditing(holiday)}
                  >
                    <PencilIcon className="size-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={deletingId === holiday.id}
                        aria-label={`Xoá ${holiday.name}`}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Xoá ngày lễ này?</AlertDialogTitle>
                        <AlertDialogDescription>
                          “{holiday.name}” ({describeRange(holiday)}) sẽ không còn hiện trên lịch
                          của ai nữa. Ca làm việc và đơn từ trong những ngày này không bị ảnh
                          hưởng.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Huỷ</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          disabled={deletingId === holiday.id}
                          onClick={() => onDelete(holiday)}
                        >
                          Xoá
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </CollapsibleGrid>
      )}

      <HolidayFormDialog open={createOpen} onOpenChange={setCreateOpen} />

      {editing && (
        <HolidayFormDialog
          key={editing.id}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          holiday={editing}
        />
      )}
    </div>
  );
}

const VALUE_FORMAT = "yyyy-MM-dd";

// Both stored dates are inclusive, so a single-day holiday reads as one date
// rather than "29/08 – 29/08". A half-day says so inline, since that changes
// what the calendar actually paints (from start_time on the first day only).
function describeRange(holiday: Holiday): string {
  const from = formatDate(holiday.start_date);
  const range =
    holiday.start_date === holiday.end_date
      ? from
      : `${from} – hết ${formatDate(holiday.end_date)}`;
  if (!holiday.half_day || !holiday.start_time) return range;
  return `${range} · nửa ngày từ ${holiday.start_time.slice(0, 5)}`;
}

function formatDate(value: string): string {
  const parsed = parse(value, VALUE_FORMAT, new Date());
  return format(parsed, "EEEE dd/MM/yyyy", { locale: vi });
}
