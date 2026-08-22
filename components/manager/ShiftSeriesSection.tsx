"use client";

import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { describeSeriesRange, describeSeriesRule } from "@/lib/shift-series";
import { SHIFT_TYPE_LABELS } from "@/lib/constants";
import type { Branch, Profile, ShiftSeriesDetailed } from "@/types";
import ShiftSeriesFormDialog from "@/components/shifts/ShiftSeriesFormDialog";
import ShiftSeriesDeleteDialog from "@/components/shifts/ShiftSeriesDeleteDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function ShiftSeriesSection({
  series,
  branchMembers,
  branches,
}: {
  series: ShiftSeriesDetailed[];
  branchMembers: Pick<Profile, "id" | "full_name" | "role" | "secondary_role" | "branch_ids">[];
  branches: Branch[];
}) {
  const [createOpen, setCreateOpen] = useState(false);
  // Holds the id rather than a boolean, and keys the dialog by it: the delete
  // dialog seeds its scope from props on mount, so a shared instance would
  // carry the previous rule's answer over to the next one.
  const [deletingId, setDeletingId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
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
        <div className="grid gap-3 lg:grid-cols-2">
          {series.map((row) => (
            <Card key={row.id}>
              <CardContent className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{row.assignee.full_name}</span>
                    <Badge variant="outline">{SHIFT_TYPE_LABELS[row.shift_type]}</Badge>
                  </div>
                  <p className="text-sm">{describeSeriesRule(row)}</p>
                  <p className="text-muted-foreground text-xs">
                    {row.branch.name} · {describeSeriesRange(row)}
                  </p>
                  {row.note && <p className="text-muted-foreground text-xs">{row.note}</p>}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Xoá ca cố định của ${row.assignee.full_name}`}
                  onClick={() => setDeletingId(row.id)}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
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
    </div>
  );
}
