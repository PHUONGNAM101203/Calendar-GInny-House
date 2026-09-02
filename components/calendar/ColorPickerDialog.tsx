"use client";

import { useRef, useState } from "react";
import { PipetteIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { hexToHsv, hsvToHex } from "@/lib/color";

const HEX_RE = /^#[0-9a-f]{6}$/i;

// A full saturation/value + hue color picker — the "+" at the end of every
// swatch grid in the app (CalendarSidebar's ColorMenu, "Tạo lịch mới")
// opens this instead of a bare hex text field, so picking "any color" feels
// as considered as picking a preset. The SV square and hue rail are plain
// layered CSS gradients (no canvas) — cheap to keep in sync with the hue
// state on every drag frame.
export default function ColorPickerDialog({
  open,
  onOpenChange,
  initialColor,
  previewLabel,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialColor: string;
  previewLabel?: string;
  onSave: (hex: string) => void;
}) {
  const [hsv, setHsv] = useState(() => hexToHsv(HEX_RE.test(initialColor) ? initialColor : "#3B82F6"));
  const [hexInput, setHexInput] = useState(() => hsvToHex(hsv));
  const squareRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Reset to initialColor each time the dialog opens — adjusted during
  // render (not in an effect) per this project's convention for "reset
  // state when a prop changes" (see hooks/use-calendar-nav.ts).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const next = hexToHsv(HEX_RE.test(initialColor) ? initialColor : "#3B82F6");
      setHsv(next);
      setHexInput(hsvToHex(next));
    }
  }

  const hex = hsvToHex(hsv);
  const supportsEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;

  function updateFromPointer(clientX: number, clientY: number) {
    const el = squareRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const y = Math.min(Math.max(clientY - rect.top, 0), rect.height);
    const s = (x / rect.width) * 100;
    const v = 100 - (y / rect.height) * 100;
    setHsv((prev) => {
      const next = { ...prev, s, v };
      setHexInput(hsvToHex(next));
      return next;
    });
  }

  function handleSquarePointerDown(e: React.PointerEvent) {
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateFromPointer(e.clientX, e.clientY);
  }

  function handleSquarePointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    updateFromPointer(e.clientX, e.clientY);
  }

  function handleHueChange(nextHue: number) {
    setHsv((prev) => {
      const next = { ...prev, h: nextHue };
      setHexInput(hsvToHex(next));
      return next;
    });
  }

  function handleHexChange(value: string) {
    setHexInput(value);
    if (HEX_RE.test(value)) setHsv(hexToHsv(value));
  }

  // Shared by the Lưu button and the Enter key so the two can never disagree
  // about what "save" means — including the validity check, which Enter has to
  // repeat because a keypress has no disabled state to lean on.
  function saveColor() {
    if (!HEX_RE.test(hexInput)) return;
    onSave(hexInput.toUpperCase());
    onOpenChange(false);
  }

  async function handleEyeDropper() {
    try {
      // EyeDropper is Chrome/Edge-only and not yet in TS's lib.dom types.
      const EyeDropperCtor = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } })
        .EyeDropper;
      const result = await new EyeDropperCtor().open();
      handleHexChange(result.sRGBHex.toUpperCase());
    } catch {
      // User cancelled the pick — nothing to do.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Chọn màu tùy chỉnh</DialogTitle>
          <DialogDescription>Chọn màu nền cho lịch này. Màu chữ sẽ được điều chỉnh tự động.</DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-3">
          <div className="flex shrink-0 flex-col items-center gap-2 pt-1">
            <span
              className="flex size-11 items-center justify-center rounded-full font-heading text-sm font-semibold text-white"
              style={{ backgroundColor: hex }}
            >
              {previewLabel}
            </span>
            {supportsEyeDropper && (
              <button
                type="button"
                onClick={handleEyeDropper}
                aria-label="Chọn màu từ màn hình"
                className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <PipetteIcon className="size-4" />
              </button>
            )}
          </div>

          <div
            ref={squareRef}
            onPointerDown={handleSquarePointerDown}
            onPointerMove={handleSquarePointerMove}
            onPointerUp={() => (draggingRef.current = false)}
            className="relative h-40 flex-1 shrink-0 cursor-crosshair touch-none rounded-lg"
            style={{
              backgroundImage:
                "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
              backgroundColor: `hsl(${hsv.h}, 100%, 50%)`,
            }}
          >
            <span
              className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
              style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, backgroundColor: hex }}
            />
          </div>
        </div>

        <input
          type="range"
          min={0}
          max={360}
          value={hsv.h}
          onChange={(e) => handleHueChange(Number(e.target.value))}
          className="h-2 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
          style={{
            backgroundImage:
              "linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)",
          }}
          aria-label="Sắc độ màu"
        />

        <div className="space-y-1.5">
          <label htmlFor="custom-hex" className="text-xs tracking-wide text-muted-foreground uppercase">
            Hệ lục phân
          </label>
          <input
            id="custom-hex"
            value={hexInput}
            onChange={(e) => handleHexChange(e.target.value)}
            // Typing a hex code and pressing Enter is the obvious way to use
            // this field. Guarded by the same HEX_RE the Lưu button is disabled
            // on, so a half-typed "#3B8" does nothing rather than saving junk.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveColor();
              }
            }}
            placeholder="#3B82F6"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button type="button" disabled={!HEX_RE.test(hexInput)} onClick={saveColor}>
            Lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
