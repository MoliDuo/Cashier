import { memo, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectableCardSurfaceProps {
  selectionMode: boolean;
  selected: boolean;
  disabled?: boolean;
  selectionLabel: string;
  onToggleSelection: () => void;
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

/**
 * Where the selection-mode expand control has to sit to land on the same pixel
 * column as the header's own chevron. The header insets from its content box,
 * which starts inside the card's 1px border; the overlay is positioned against
 * the card's outer edge, so it has to add that pixel back — without it the
 * arrow steps 1px sideways the moment selection mode starts.
 */
const EXPAND_OVERLAY_INSET = "left-[calc(0.25rem+1px)] sm:left-[calc(0.5rem+1px)]";

export const SelectableCardSurface = memo(function SelectableCardSurface({
  selectionMode,
  selected,
  disabled = false,
  selectionLabel,
  onToggleSelection,
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
        // No box to tick: the card's own outline is the indicator, so a row
        // reads as selected without anything printed over its content. The
        // button is still one full-card checkbox for assistive tech, and it
        // carries the focus ring the removed box used to.
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={selectionLabel}
          disabled={disabled}
          onClick={onToggleSelection}
          className={cn(
            "absolute inset-0 cursor-pointer touch-manipulation text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed",
            radiusClassName
          )}
        />
      ) : null}
      {selectionMode && expandable ? (
        <button
          type="button"
          aria-label={expandable.expandLabel}
          aria-expanded={expandable.isExpanded}
          aria-controls={expandable.contentId}
          onClick={expandable.onToggleExpanded}
          className={cn(
            "absolute top-[calc(var(--selectable-card-header-height)/2)] z-[1] flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color] duration-[var(--motion-feedback)] hover:bg-surface2",
            EXPAND_OVERLAY_INSET
          )}
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
