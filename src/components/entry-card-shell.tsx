import { memo, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Which state the card is in, when that state is worth painting. */
export type EntryCardTone = "default" | "busy" | "danger" | "muted";

interface EntryCardShellProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  interactive?: boolean;
  tone?: EntryCardTone;
}

/**
 * The surface a card row is painted on. A tone replaces the neutral border and
 * background — a card that is still working, one whose document failed, one
 * that is inert. Selection outranks it: a selected card reads as selected
 * whatever else is true of it.
 */
const toneClass: Record<EntryCardTone, string> = {
  default: "border-border",
  busy: "border-primary/25 bg-primary/5",
  danger: "border-danger/20 bg-danger/5",
  muted: "border-border bg-surface2",
};

export const EntryCardShell = memo(function EntryCardShell({
  selected = false,
  interactive = false,
  tone = "default",
  className,
  ...props
}: EntryCardShellProps) {
  return (
    <div
      className={cn(
        // Same height as a card's header row, so a single-row card matches a
        // collapsed one and a source document's header matches the entry rows
        // it expands over. Relative so a state overlay can be clipped to the
        // card's own rounded corners.
        "relative min-h-[var(--selectable-card-header-height,56px)] overflow-hidden rounded-[var(--radius-xl)] border bg-surface text-text shadow-[0_1px_2px_color-mix(in_srgb,var(--text),transparent_95%)] transition-[border-color,background-color,box-shadow,opacity]",
        selected ? "border-primary bg-primary/5 ring-1 ring-primary/20" : toneClass[tone],
        interactive &&
          "cursor-pointer hover:border-primary/50 hover:shadow-sm focus-within:border-primary/50",
        className
      )}
      {...props}
    />
  );
});
