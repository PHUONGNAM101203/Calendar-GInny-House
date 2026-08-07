"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  MenuIcon,
  PlusIcon,
  CheckIcon,
  MinusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Trash2Icon,
  LinkIcon,
  LayoutGridIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getPersonColorVar, resolveColor, isCustomHexColor, EVENT_COLOR_SWATCHES } from "@/lib/calendar";
import {
  followPersonAction,
  unfollowPersonAction,
  updateFollowColorAction,
  followGroupAction,
  unfollowGroupAction,
} from "@/actions/calendar-follows";
import { updateBranchColorAction } from "@/actions/branch-colors";
import { createCustomCalendarAction, deleteCustomCalendarAction } from "@/actions/custom-calendars";
import ShiftRequestDialog from "@/components/shifts/ShiftRequestDialog";
import MiniMonth from "@/components/calendar/MiniMonth";
import CustomEventFormDialog from "@/components/calendar/CustomEventFormDialog";
import ColorPickerDialog from "@/components/calendar/ColorPickerDialog";
import type { ActionResult, Branch, CustomCalendar } from "@/types";

type Person = { id: string; name: string; followed: boolean; color: string | null };
type PersonGroup = { key: string; label: string; people: Person[] };

type EventTypeToggles = {
  showAttendance: boolean;
  showLeave: boolean;
  showLateArrival: boolean;
  showSwapIndicator: boolean;
};

type SidebarProps = {
  canManageShifts: boolean;
  date: Date;
  onPickDate: (date: Date) => void;
  onOpenDay: (date: Date) => void;
  onCreate: () => void;
  people: Person[];
  groups: PersonGroup[] | null;
  canFollowAll: boolean;
  currentUserName: string;
  showHolidays: boolean;
  onToggleHolidays: (next: boolean) => void;
  eventToggles: EventTypeToggles;
  onEventTogglesChange: (next: EventTypeToggles) => void;
  customCalendars: CustomCalendar[];
  hiddenCustomCalendarIds: Set<string>;
  onToggleCustomCalendar: (calendarId: string, visible: boolean) => void;
  branches: Branch[];
  requestableBranches: Branch[];
  hiddenBranchKeys: Set<string>;
  onToggleBranch: (key: string, visible: boolean) => void;
  branchColors: Record<string, string>;
};

// The Google Calendar move this whole sidebar is styled after: a small
// colored square that IS the checkbox — filled + checkmark when on, just an
// outline when off. One shape does double duty as "this calendar's color"
// and "is it visible right now."
function CalendarCheckItem({
  label,
  checked,
  onChange,
  colorVar,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  colorVar: string;
  disabled?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        disabled={disabled}
        aria-pressed={checked}
        className="flex w-full items-center gap-2 truncate text-left disabled:opacity-70"
      >
        <span
          className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px]"
          style={{
            backgroundColor: checked ? resolveColor(colorVar) : "transparent",
            boxShadow: `inset 0 0 0 1.5px ${resolveColor(colorVar)}`,
          }}
        >
          {checked && <CheckIcon className="size-2.5 text-white" strokeWidth={3} />}
        </span>
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}

// Same checkbox-square shape as CalendarCheckItem, but with a hover-reveal
// color picker attached (branches support a personal color override, a
// plain CalendarCheckItem doesn't need one).
function BranchRow({
  label,
  checked,
  onChange,
  colorVar,
  onPickColor,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  colorVar: string;
  onPickColor: (color: string) => Promise<ActionResult>;
}) {
  return (
    <li className="group/color-row flex items-center gap-2 truncate">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        className="flex min-w-0 flex-1 items-center gap-2 truncate text-left"
      >
        <span
          className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px]"
          style={{
            backgroundColor: checked ? resolveColor(colorVar) : "transparent",
            boxShadow: `inset 0 0 0 1.5px ${resolveColor(colorVar)}`,
          }}
        >
          {checked && <CheckIcon className="size-2.5 text-white" strokeWidth={3} />}
        </span>
        <span className="truncate">{label}</span>
      </button>
      <ColorMenu onPick={onPickColor} previewLabel={label.trim().charAt(0).toUpperCase()} currentColorVar={colorVar} />
    </li>
  );
}

// 6-per-row swatch circles, same shape as Google Calendar's own
// color-swatch menu — plus a trailing "+" cell that opens the full
// saturation/hue ColorPickerDialog for a truly custom pick. Shared between
// the follow-color menu and "Tạo lịch mới" so both pickers match.
function SwatchGrid({
  value,
  onChange,
  previewLabel,
}: {
  value: string;
  onChange: (color: string) => void;
  previewLabel?: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const isCustom = isCustomHexColor(value);

  return (
    <>
      <div className="grid grid-cols-6 gap-2">
        {EVENT_COLOR_SWATCHES.map((swatch) => (
          <button
            key={swatch.var}
            type="button"
            title={swatch.label}
            onClick={() => onChange(swatch.var)}
            className="flex size-7 items-center justify-center rounded-full transition-transform hover:scale-110"
            style={{ backgroundColor: resolveColor(swatch.var) }}
          >
            {value === swatch.var && (
              <CheckIcon
                className="size-3.5"
                style={{
                  color:
                    swatch.var === "--gold" || swatch.var === "--palette-flamingo"
                      ? "var(--gold-foreground)"
                      : "white",
                }}
              />
            )}
          </button>
        ))}
        <button
          type="button"
          title="Màu tùy chỉnh"
          onClick={() => setPickerOpen(true)}
          className="flex size-7 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground transition-transform hover:scale-110 hover:text-foreground"
          style={isCustom ? { borderStyle: "solid", borderColor: value, backgroundColor: value } : undefined}
        >
          {isCustom ? <CheckIcon className="size-3.5 text-white" /> : <PlusIcon className="size-3.5" />}
        </button>
      </div>

      <ColorPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initialColor={isCustom ? value : "#3B82F6"}
        previewLabel={previewLabel}
        onSave={onChange}
      />
    </>
  );
}

// Generic "pick a display color" popover trigger — shared by any row that
// needs a personal color override (people you follow, and now branches in
// the "Cơ sở" filter). The reveal-on-hover chevron relies on its ancestor
// row carrying the `group/color-row` class (see PersonRow, BranchRow).
function ColorMenu({
  onPick,
  previewLabel,
  currentColorVar,
}: {
  onPick: (color: string) => Promise<ActionResult>;
  previewLabel: string;
  currentColorVar: string;
}) {
  const [isPending, startTransition] = useTransition();

  function pick(color: string) {
    startTransition(async () => {
      const result = await onPick(color);
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isPending}
          aria-label="Đổi màu hiển thị"
          className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/color-row:opacity-100 disabled:opacity-50"
        >
          <ChevronDownIcon className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <SwatchGrid value={currentColorVar} onChange={pick} previewLabel={previewLabel} />
      </PopoverContent>
    </Popover>
  );
}

function PersonRow({ person, canFollowAll }: { person: Person; canFollowAll: boolean }) {
  const [isPending, startTransition] = useTransition();
  const colorVar = getPersonColorVar(person.id, person.color);

  function toggleFollow() {
    startTransition(async () => {
      const result = person.followed
        ? await unfollowPersonAction(person.id)
        : await followPersonAction(person.id);
      if (!result.ok) toast.error(result.error);
    });
  }

  if (!canFollowAll) {
    return (
      <li className="flex items-center gap-2 truncate">
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: resolveColor(colorVar) }} />
        <span className="truncate">{person.name}</span>
      </li>
    );
  }

  return (
    <li className="group/color-row flex items-center gap-2 truncate">
      <button
        type="button"
        onClick={toggleFollow}
        disabled={isPending}
        aria-pressed={person.followed}
        aria-label={person.followed ? `Bỏ theo dõi lịch ${person.name}` : `Theo dõi lịch ${person.name}`}
        className="flex min-w-0 flex-1 items-center gap-2 truncate text-left disabled:opacity-50"
      >
        <span
          className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px]"
          style={{
            backgroundColor: person.followed ? resolveColor(colorVar) : "transparent",
            boxShadow: `inset 0 0 0 1.5px ${resolveColor(colorVar)}`,
          }}
        >
          {person.followed && <CheckIcon className="size-2.5 text-white" strokeWidth={3} />}
        </span>
        <span className="truncate">{person.name}</span>
      </button>
      <ColorMenu
        onPick={(color) => updateFollowColorAction(person.id, color)}
        previewLabel={person.name.trim().charAt(0).toUpperCase()}
        currentColorVar={colorVar}
      />
    </li>
  );
}

function CustomCalendarRow({
  calendar,
  visible,
  onToggle,
}: {
  calendar: CustomCalendar;
  visible: boolean;
  onToggle: (next: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [addEventOpen, setAddEventOpen] = useState(false);

  function handleDelete() {
    if (!window.confirm(`Xoá lịch "${calendar.name}" cùng toàn bộ sự kiện trong đó?`)) return;
    startTransition(async () => {
      const result = await deleteCustomCalendarAction(calendar.id);
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <li className="group/custom flex items-center gap-2 truncate">
      <button
        type="button"
        onClick={() => onToggle(!visible)}
        aria-pressed={visible}
        className="flex min-w-0 flex-1 items-center gap-2 truncate text-left"
      >
        <span
          className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px]"
          style={{
            backgroundColor: visible ? resolveColor(calendar.color) : "transparent",
            boxShadow: `inset 0 0 0 1.5px ${resolveColor(calendar.color)}`,
          }}
        >
          {visible && <CheckIcon className="size-2.5 text-white" strokeWidth={3} />}
        </span>
        <span className="truncate">{calendar.name}</span>
      </button>
      <button
        type="button"
        onClick={() => setAddEventOpen(true)}
        aria-label={`Thêm sự kiện vào ${calendar.name}`}
        className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/custom:opacity-100"
      >
        <PlusIcon className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        aria-label={`Xoá lịch ${calendar.name}`}
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive group-hover/custom:opacity-100 disabled:opacity-50"
      >
        <Trash2Icon className="size-3.5" />
      </button>

      <CustomEventFormDialog
        open={addEventOpen}
        onOpenChange={setAddEventOpen}
        calendarId={calendar.id}
        calendarName={calendar.name}
      />
    </li>
  );
}

// The "+" next to "Lịch khác" — "Tạo lịch mới" is the only path built so
// far; "Từ URL / file" and "Duyệt lịch có sẵn" are placeholders reserving
// their spot in the menu for later (see hallmark audit, 2026-08).
function AddOtherCalendarMenu() {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(EVENT_COLOR_SWATCHES[0].var);

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await createCustomCalendarAction(trimmed, color);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setName("");
    });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Thêm lịch khác"
          className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3 p-3">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Tạo lịch mới</p>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tên lịch, vd: Lịch thi thử"
            className="h-8 text-sm"
          />
          <SwatchGrid value={color} onChange={setColor} previewLabel={name.trim().charAt(0).toUpperCase() || undefined} />
          <Button size="sm" className="h-7 w-full text-xs" disabled={isPending || !name.trim()} onClick={handleCreate}>
            Tạo lịch
          </Button>
        </div>

        <div className="space-y-1 border-t pt-2">
          <button
            type="button"
            disabled
            className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm text-muted-foreground/50"
          >
            <LinkIcon className="size-3.5 shrink-0" />
            Nhập từ URL / file
            <span className="ml-auto text-[10px]">Sắp có</span>
          </button>
          <button
            type="button"
            disabled
            className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm text-muted-foreground/50"
          >
            <LayoutGridIcon className="size-3.5 shrink-0" />
            Duyệt lịch có sẵn trong công ty
            <span className="ml-auto text-[10px]">Sắp có</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Group header: a tri-state checkbox-square (same visual language as
// PersonRow/CalendarCheckItem) that bulk-follows/unfollows every member at
// once, plus a collapse toggle for the member list below it.
function GroupCheckbox({
  triState,
  onToggle,
  disabled,
}: {
  triState: "all" | "some" | "none";
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={triState === "all" ? "Bỏ theo dõi cả nhóm" : "Theo dõi cả nhóm"}
      className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px] disabled:opacity-50"
      style={{
        backgroundColor: triState === "none" ? "transparent" : "var(--foreground)",
        boxShadow: "inset 0 0 0 1.5px var(--foreground)",
      }}
    >
      {triState === "all" && <CheckIcon className="size-2.5 text-background" strokeWidth={3} />}
      {triState === "some" && <MinusIcon className="size-2.5 text-background" strokeWidth={3} />}
    </button>
  );
}

function GroupSection({ group, canFollowAll }: { group: PersonGroup; canFollowAll: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const followedCount = group.people.filter((p) => p.followed).length;
  const triState: "all" | "some" | "none" =
    group.people.length === 0
      ? "none"
      : followedCount === group.people.length
        ? "all"
        : followedCount === 0
          ? "none"
          : "some";

  function toggleGroup() {
    const ids = group.people.map((p) => p.id);
    startTransition(async () => {
      const result = triState === "all" ? await unfollowGroupAction(ids) : await followGroupAction(ids);
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        {canFollowAll && group.people.length > 0 && (
          <GroupCheckbox triState={triState} onToggle={toggleGroup} disabled={isPending} />
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-1 items-center gap-1 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {collapsed ? <ChevronRightIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
          <span className="truncate">{group.label}</span>
          <span className="ml-auto shrink-0 font-normal normal-case">{group.people.length}</span>
        </button>
      </div>
      {!collapsed && group.people.length > 0 && (
        <ul className="mb-3 space-y-1.5 pl-[22px] text-sm">
          {group.people.map((person) => (
            <PersonRow key={person.id} person={person} canFollowAll={canFollowAll} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SidebarContent({
  canManageShifts,
  date,
  onPickDate,
  onOpenDay,
  onCreate,
  people,
  groups,
  canFollowAll,
  currentUserName,
  showHolidays,
  onToggleHolidays,
  eventToggles,
  onEventTogglesChange,
  customCalendars,
  hiddenCustomCalendarIds,
  onToggleCustomCalendar,
  branches,
  requestableBranches,
  hiddenBranchKeys,
  onToggleBranch,
  branchColors,
}: SidebarProps) {
  return (
    <div className="flex flex-col gap-6">
      {canManageShifts ? (
        <Button onClick={onCreate} className="justify-start gap-2">
          <PlusIcon className="size-4" />
          Tạo ca làm việc
        </Button>
      ) : (
        <ShiftRequestDialog branches={requestableBranches} />
      )}

      <MiniMonth date={date} onPick={onPickDate} onOpenDay={onOpenDay} />

      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {groups ? "Bạn" : canFollowAll ? "Toàn hệ thống" : "Chú giải"}
        </p>
        <ul className="space-y-1.5 text-sm">
          <li className="flex items-center gap-2">
            <span className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px] bg-primary">
              <CheckIcon className="size-2.5 text-primary-foreground" strokeWidth={3} />
            </span>
            <span className="truncate">{currentUserName}</span>
          </li>
          {!groups && people.map((person) => <PersonRow key={person.id} person={person} canFollowAll={canFollowAll} />)}
        </ul>
      </div>

      {groups && (
        <div className="space-y-1">
          {groups.map((group) => (
            <GroupSection key={group.key} group={group} canFollowAll={canFollowAll} />
          ))}
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Loại sự kiện
        </p>
        <ul className="space-y-1.5 text-sm">
          <CalendarCheckItem
            label="Chấm công"
            checked={eventToggles.showAttendance}
            onChange={(v) => onEventTogglesChange({ ...eventToggles, showAttendance: v })}
            colorVar="--chart-3"
          />
          <CalendarCheckItem
            label="Nghỉ phép"
            checked={eventToggles.showLeave}
            onChange={(v) => onEventTogglesChange({ ...eventToggles, showLeave: v })}
            colorVar="--chart-5"
          />
          <CalendarCheckItem
            label="Đến muộn"
            checked={eventToggles.showLateArrival}
            onChange={(v) => onEventTogglesChange({ ...eventToggles, showLateArrival: v })}
            colorVar="--gold"
          />
          <CalendarCheckItem
            label="Đổi ca"
            checked={eventToggles.showSwapIndicator}
            onChange={(v) => onEventTogglesChange({ ...eventToggles, showSwapIndicator: v })}
            colorVar="--chart-6"
          />
        </ul>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Cơ sở
        </p>
        <ul className="space-y-1.5 text-sm">
          {branches.map((branch) => (
            <BranchRow
              key={branch.id}
              label={branch.name}
              checked={!hiddenBranchKeys.has(branch.id)}
              onChange={(v) => onToggleBranch(branch.id, v)}
              colorVar={branchColors[branch.id] ?? `--${branch.color_token}`}
              onPickColor={(color) => updateBranchColorAction(branch.id, color)}
            />
          ))}
          <BranchRow
            label="Remote"
            checked={!hiddenBranchKeys.has("remote")}
            onChange={(v) => onToggleBranch("remote", v)}
            colorVar={branchColors["remote"] ?? "--chart-4"}
            onPickColor={(color) => updateBranchColorAction("remote", color)}
          />
        </ul>
      </div>

      <div>
        <div className="mb-2 flex items-center">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Lịch khác
          </p>
          <AddOtherCalendarMenu />
        </div>
        <ul className="space-y-1.5 text-sm">
          <CalendarCheckItem
            label="Ngày lễ ở Việt Nam"
            checked={showHolidays}
            onChange={onToggleHolidays}
            colorVar="--success"
          />
          {customCalendars.map((calendar) => (
            <CustomCalendarRow
              key={calendar.id}
              calendar={calendar}
              visible={!hiddenCustomCalendarIds.has(calendar.id)}
              onToggle={(next) => onToggleCustomCalendar(calendar.id, next)}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

export function CalendarSidebar(props: SidebarProps) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r px-4 py-5 lg:flex">
      <SidebarContent {...props} />
    </aside>
  );
}

export function CalendarMobileMenu(props: SidebarProps) {
  return (
    <div className="mb-2 lg:hidden">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <MenuIcon className="size-4" />
            Bộ lọc &amp; chú giải
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          <SidebarContent {...props} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
