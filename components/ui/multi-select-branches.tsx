"use client";

import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Branch } from "@/types";

export function MultiSelectBranches({
  branches,
  value,
  onChange,
  disabled = false,
  placeholder = "Chọn cơ sở",
}: {
  branches: Branch[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const selected = branches.filter((b) => value.includes(b.id));

  function toggle(branchId: string) {
    onChange(
      value.includes(branchId) ? value.filter((id) => id !== branchId) : [...value, branchId]
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-3 py-1.5 text-left text-sm shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          {selected.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            selected.map((b) => (
              <Badge
                key={b.id}
                variant="secondary"
                className="gap-1 pr-1"
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                {b.name}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Bỏ chọn ${b.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(b.id);
                  }}
                  className="rounded-full p-0.5 hover:bg-foreground/10"
                >
                  <XIcon className="size-3" />
                </span>
              </Badge>
            ))
          )}
          <ChevronDownIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <ul className="space-y-0.5">
          {branches.map((branch) => {
            const checked = value.includes(branch.id);
            return (
              <li key={branch.id}>
                <button
                  type="button"
                  onClick={() => toggle(branch.id)}
                  aria-pressed={checked}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <span
                    className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px]"
                    style={{
                      backgroundColor: checked ? "var(--primary)" : "transparent",
                      boxShadow: "inset 0 0 0 1.5px var(--primary)",
                    }}
                  >
                    {checked && <CheckIcon className="size-2.5 text-primary-foreground" strokeWidth={3} />}
                  </span>
                  <span className="truncate">{branch.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
