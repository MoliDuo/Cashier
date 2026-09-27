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
  /** Every item is on screen, so the counts speak of items, not of what has loaded. */
  wholeList?: boolean;
  isAllSelected: boolean;
  /** More pages exist, so a select-all leaves the unloaded ones out and says so. */
  hasMoreData?: boolean;
  disabled?: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  /** A note under the counts, such as which actions a large selection limits. */
  note?: ReactNode;
  /** The surface's own actions, on the same row as the select-all box. */
  children?: ReactNode;
  className?: string;
}

/**
 * What every selecting list shows: the select-all box with what it does, the
 * surface's actions beside it, and the counts underneath. Which actions there
 * are is the surface's business; this band is the same everywhere.
 *
 * The box says how much is in — empty, mixed or ticked — so its words say what
 * pressing it does, flipping from select-all to deselect-all once everything
 * loaded is in.
 */
export function SelectionBar({
  selectedCount,
  loadedCount,
  wholeList = false,
  isAllSelected,
  hasMoreData = false,
  disabled = false,
  onSelectAll,
  onClearSelection,
  note,
  children,
  className,
}: SelectionBarProps) {
  const selectAllLabel = wholeList
    ? batchActionsCopy.selectAllItemCount({ count: loadedCount })
    : batchActionsCopy.selectAllLoadedCount({ loaded: loadedCount });
  const boxLabel = isAllSelected ? batchActionsCopy.deselectAll : selectAllLabel;
  const checked: boolean | "indeterminate" = isAllSelected
    ? true
    : selectedCount > 0
      ? "indeterminate"
      : false;

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <label className="flex min-w-0 items-center gap-2">
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => {
            if (next === true) onSelectAll();
            else onClearSelection();
          }}
          // The box's own name, because the label next to it also carries the
          // loaded-scope note, which is not part of what the control is.
          aria-label={boxLabel}
          className="h-4 w-4"
        />
        <span className={textRoleClassName("bodyStrong", "whitespace-nowrap")}>{boxLabel}</span>
        {isAllSelected && hasMoreData ? (
          <span className={textRoleClassName("meta", "whitespace-nowrap")}>
            {batchActionsCopy.loadedOnly}
          </span>
        ) : null}
      </label>

      {children}

      <div className={textRoleClassName("meta", "basis-full space-y-0.5")} aria-live="polite">
        <p>
          {wholeList
            ? batchActionsCopy.selectedItemCount({ selected: selectedCount })
            : batchActionsCopy.selectedLoadedCount({
                selected: selectedCount,
                loaded: loadedCount,
              })}
        </p>
        {hasMoreData ? <p>{batchActionsCopy.unloadedExcluded}</p> : null}
        {note}
      </div>
    </div>
  );
}
