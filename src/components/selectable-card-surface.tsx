import { memo, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectableCardSurfaceProps {
  selectionMode: boolean;
  selected: boolean;
  disabled?: boolean;
  selectionLabel: string;
  onToggleSelection: () => void;
  indicatorPlacement?: "center" | "header";
  /**
   * Corner radius of the surface. Defaults to one card's own radius. A row that
   * is not a card of its own — a full-bleed row inside a shared entries card —
   * passes the corners of the card it sits in, so the selected outline runs
   * along the container's edge instead of curving away from it.
   */
  radiusClassName?: string;
  /**
   * When set, an expand/collapse control is rendered above the selection
   * overlay while in selection mode so cards with an expandable body keep
   * their chevron interactive during batch selection.
   */
  expandable?:
    | {
        isExpanded: boolean;
        onToggleExpanded: () => void;
        expandLabel: string;
        contentId?: string;
      }
    | undefined;
  children: ReactNode;
}

const indicatorPositionClass: Record<
  NonNullable<SelectableCardSurfaceProps["indicatorPlacement"]>,
  string
> = {
  // Centered on the whole card — correct for single-row (non-expandable) cards.
  center: "top-1/2 -translate-y-1/2",
  // Share the title row's height so expansion never shifts the selection indicator.
  header: "top-[calc(var(--selectable-card-header-height)/2)] -translate-y-1/2",
};

export const SelectableCardSurface = memo(function SelectableCardSurface({
  selectionMode,
  selected,
  disabled = false,
  selectionLabel,
  onToggleSelection,
  indicatorPlacement = "center",
  radiusClassName = "rounded-[var(--radius-xl)]",
  expandable,
  children,
}: SelectableCardSurfaceProps) {
  return (
    <div
      className={cn(
        // One row of a card. Every card in the ledger — a collapsed source
        // document, an entry card in the details tab — is this tall, and the
        // source-document header is this tall, so an expanded card's header
        // lines up with the entry rows underneath it.
        "relative [--selectable-card-header-height:56px]",
        radiusClassName,
        selectionMode && "isolate",
        selectionMode && selected && "ring-1 ring-primary",
        selectionMode && disabled && "opacity-60"
      )}
      data-selection-mode={selectionMode ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
    >
      <div inert={selectionMode ? true : undefined}>{children}</div>
      {selectionMode ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={selectionLabel}
          disabled={disabled}
          onClick={onToggleSelection}
          className="group absolute inset-0 cursor-pointer touch-manipulation rounded-[var(--radius-xl)] text-left focus-visible:outline-none disabled:cursor-not-allowed"
        >
          <span
            aria-hidden="true"
            className={cn(
              // Neutral outline until the card is actually selected: a
              // primary-tinted box on every row reads as "selected" already.
              "absolute left-3 flex size-5 items-center justify-center rounded-sm border border-muted-foreground/40 bg-background text-primary-foreground group-focus-visible:outline-2 group-focus-visible:-outline-offset-2 group-focus-visible:outline-ring",
              indicatorPositionClass[indicatorPlacement],
              selected && "border-primary bg-primary group-focus-visible:outline-bg"
            )}
          >
            {selected ? <Check className="size-4" /> : null}
          </span>
        </button>
      ) : null}
      {selectionMode && expandable ? (
        <button
          type="button"
          aria-label={expandable.expandLabel}
          aria-expanded={expandable.isExpanded}
          aria-controls={expandable.contentId}
          onClick={expandable.onToggleExpanded}
          className="absolute left-11 top-[calc(var(--selectable-card-header-height)/2)] z-[1] flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color] duration-[var(--motion-feedback)] hover:bg-surface2"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "h-4 w-4 transition-transform duration-[var(--motion-feedback)] ease-[var(--motion-state-ease)]",
              expandable.isExpanded && "rotate-180"
            )}
          />
        </button>
      ) : null}
    </div>
  );
});
