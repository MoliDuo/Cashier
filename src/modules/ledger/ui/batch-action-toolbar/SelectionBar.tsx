"use client";
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { textRoleClassName } from "@/components/typography";
import { cn } from "@/lib/utils";
import { batchActionsCopy } from "@/copy/workspace";

interface SelectionBarProps {
  selectedCount: number;
  /** How many items are on screen; the select-all box selects exactly these. */
  loadedCount: number;
  isAllSelected: boolean;
  /** More pages exist, so the count says it is out of what has loaded. */
  hasMoreData?: boolean;
  disabled?: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  /** A note under the actions, such as which actions a large selection limits. */
  note?: ReactNode;
  /** The surface's own actions, on the row under the select-all box. */
  children?: ReactNode;
  className?: string;
}

/** The count the selection bar and a phone's top bar both print. */
export function selectionCountText(input: {
  selectedCount: number;
  loadedCount: number;
  hasMoreData: boolean;
}): string {
  return input.hasMoreData
    ? batchActionsCopy.selectedOfLoaded({
        selected: input.selectedCount,
        loaded: input.loadedCount,
      })
    : batchActionsCopy.selectedOfTotal({ selected: input.selectedCount, total: input.loadedCount });
}

/**
 * The select-all box and its words. The box says how much is in — empty, mixed
 * or ticked — so the words only say what pressing it does. Pressing it selects
 * everything loaded, or clears once everything is in.
 */
export function SelectAllToggle({
  checked,
  disabled = false,
  onToggle,
  className,
}: {
  checked: boolean | "indeterminate";
  disabled?: boolean;
  /** Pressed: select all when not everything is in, clear when it is. */
  onToggle: () => void;
  className?: string;
}) {
  const boxLabel = checked === true ? batchActionsCopy.deselectAll : batchActionsCopy.selectAll;
  return (
    <label className={cn("flex min-w-0 items-center gap-2", className)}>
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={onToggle}
        aria-label={boxLabel}
        className="h-4 w-4"
      />
      <span className={textRoleClassName("bodyStrong", "whitespace-nowrap")}>{boxLabel}</span>
    </label>
  );
}

/**
 * What every selecting list shows: the select-all box and the count on one
 * row, the surface's actions on the next. Which actions there are is the
 * surface's business; this band is the same everywhere.
 *
 * The box says how much is in — empty, mixed or ticked — so its words only say
 * what pressing it does, flipping from select-all to deselect-all once
 * everything loaded is in. The count is the one place a number appears; when
 * more pages exist it counts against what has loaded, which is also all the
 * box can select.
 */
export function SelectionBar({
  selectedCount,
  loadedCount,
  isAllSelected,
  hasMoreData = false,
  disabled = false,
  onSelectAll,
  onClearSelection,
  note,
  children,
  className,
}: SelectionBarProps) {
  const checked: boolean | "indeterminate" = isAllSelected
    ? true
    : selectedCount > 0
      ? "indeterminate"
      : false;

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {/* As tall as the toolbar's own controls, so the row lines up with the
          back button beside the band. */}
      <div className="flex min-h-8 min-w-0 items-center justify-between gap-2">
        <SelectAllToggle
          checked={checked}
          disabled={disabled}
          onToggle={() => (isAllSelected ? onClearSelection() : onSelectAll())}
        />
        <p
          className={textRoleClassName("meta", "whitespace-nowrap tabular-nums")}
          aria-live="polite"
        >
          {selectionCountText({ selectedCount, loadedCount, hasMoreData })}
        </p>
      </div>

      {children}

      {note != null ? <div className={textRoleClassName("meta")}>{note}</div> : null}
    </div>
  );
}
