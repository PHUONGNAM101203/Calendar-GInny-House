"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PencilIcon, PlusIcon, Trash2Icon, UserPlusIcon } from "lucide-react";
import { describeSeriesRange, describeSeriesRule, formatSlotWindow } from "@/lib/shift-series";
import { SHIFT_TYPE_LABELS } from "@/lib/constants";
import { deleteShiftSlotAction } from "@/actions/shift-series";
import type { Branch, Profile, ShiftSeriesDetailed, ShiftSlotDetailed } from "@/types";
import ShiftSeriesFormDialog from "@/components/shifts/ShiftSeriesFormDialog";
import ShiftSeriesDeleteDialog from "@/components/shifts/ShiftSeriesDeleteDialog";
import ShiftSeriesEditDialog from "@/components/shifts/ShiftSeriesEditDialog";
import ShiftSlotAssignDialog from "@/components/shifts/ShiftSlotAssignDialog";
import CollapsibleGrid from "@/components/manager/CollapsibleGrid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function ShiftSeriesSection({
  series,
  slots,
  branchMembers,
  branches,
}: {
  series: ShiftSeriesDetailed[];
  slots: ShiftSlotDetailed[];
  branchMembers: Pick<
    Profile,
    "id" | "full_name" | "role" | "secondary_role" | "covers_reception" | "branch_ids"
  >[];
  branches: Branch[];
}) {
  const [createOpen, setCreateOpen] = useState(false);
  // Holds the id rather than a boolean, and keys the dialog by it: the delete
  // dialog seeds its scope from props on mount, so a shared instance would
  // carry the previous rule's answer over to the next one.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Same id-not-boolean reasoning as deletingId above: the edit dialog seeds
  // every field from the series on mount, so a shared instance would show the
  // previously-opened rule's values.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Resolved from the live list rather than stashed in state, so the dialog
  // reopens against fresh data after a revalidate rather than a stale copy.
  const editingSeries = series.find((row) => row.id === editingId) ?? null;
  const [assigningSlot, setAssigningSlot] = useState<ShiftSlotDetailed | null>(null);
  const [removingSlotId, setRemovingSlotId] = useState<string | null>(null);

  async function onRemoveSlot(slotId: string) {
    setRemovingSlotId(slotId);
    try {
      const result = await deleteShiftSlotAction(slotId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Đã xoá ô ca");
    } finally {
      setRemovingSlotId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-4" />
          Tạo ca cố định
        </Button>
      </div>

      {series.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Chưa có ca cố định nào. Tạo một ca để khỏi phải xếp lại cùng một lịch mỗi tuần.
        </p>
      ) : (
        <CollapsibleGrid className="grid gap-3 lg:grid-cols-2">
          {series.map((row) => (
            <Card key={row.id}>
              <CardContent className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* An unassigned rule has no name to show. Saying so plainly
                        beats an empty gap, and beats inventing a placeholder
                        name that could be mistaken for a real person. */}
                    {row.assignee ? (
                      <span className="truncate font-medium">{row.assignee.full_name}</span>
                    ) : (
                      <Badge variant="gold">Chưa gán người</Badge>
                    )}
                    <Badge variant="outline">{SHIFT_TYPE_LABELS[row.shift_type]}</Badge>
                  </div>
                  <p className="text-sm">{describeSeriesRule(row)}</p>
                  <p className="text-muted-foreground text-xs">
                    {row.branch.name} · {describeSeriesRange(row)}
                  </p>
                  {row.note && <p className="text-muted-foreground text-xs">{row.note}</p>}
                </div>
                <div className="flex shrink-0 items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={
                      row.assignee
                        ? `Sửa ca cố định của ${row.assignee.full_name}`
                        : "Sửa ca cố định chưa gán người"
                    }
                    onClick={() => setEditingId(row.id)}
                  >
                    <PencilIcon className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={
                      row.assignee
                        ? `Xoá ca cố định của ${row.assignee.full_name}`
                        : "Xoá ca cố định chưa gán người"
                    }
                    onClick={() => setDeletingId(row.id)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </CollapsibleGrid>
      )}

      {/* Only rendered when there is something to fill. An always-visible
          empty panel would imply the feature is broken rather than unused. */}
      {slots.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">Ô ca chưa gán người</h3>
            <span className="text-muted-foreground text-xs tabular-nums">{slots.length}</span>
          </div>
          <p className="text-muted-foreground text-xs">
            Nhân viên không nhìn thấy những ô này. Ca chỉ xuất hiện trên lịch của họ sau khi
            được gán tên.
          </p>
          <div className="grid gap-2 lg:grid-cols-2">
            {slots.map((slot) => (
              <Card key={slot.id}>
                <CardContent className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-sm">{formatSlotWindow(slot.start_at, slot.end_at)}</p>
                    <p className="text-muted-foreground text-xs">
                      {slot.branch.name} · {SHIFT_TYPE_LABELS[slot.shift_type]}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button type="button" size="sm" onClick={() => setAssigningSlot(slot)}>
                      <UserPlusIcon className="size-4" />
                      Gán người
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={removingSlotId === slot.id}
                      aria-label="Xoá ô ca này"
                      onClick={() => onRemoveSlot(slot.id)}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <ShiftSeriesFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        branchMembers={branchMembers}
        branches={branches}
      />

      {deletingId && (
        <ShiftSeriesDeleteDialog
          key={deletingId}
          open
          onOpenChange={(open) => {
            if (!open) setDeletingId(null);
          }}
          seriesId={deletingId}
        />
      )}

      {editingSeries && (
        <ShiftSeriesEditDialog
          key={editingSeries.id}
          open
          onOpenChange={(open) => {
            if (!open) setEditingId(null);
          }}
          series={editingSeries}
          branchMembers={branchMembers}
          branches={branches}
        />
      )}

      {assigningSlot && (
        <ShiftSlotAssignDialog
          key={assigningSlot.id}
          slot={assigningSlot}
          branchMembers={branchMembers}
          open
          onOpenChange={(open) => {
            if (!open) setAssigningSlot(null);
          }}
        />
      )}
    </div>
  );
}
