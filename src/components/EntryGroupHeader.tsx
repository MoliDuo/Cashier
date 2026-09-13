import { Check, Minus } from "lucide-react";
import { AmountText } from "@/modules/currency/ui/amount-text";
import { textRoleClassName } from "@/components/typography";
import { cn } from "@/lib/utils";

export interface EntryGroupSelection {
  /** How much of the group is in: nothing, part of it, or all of it. */
  state: "none" | "some" | "all";
  /** What the control does, named for the day it opens. */
  label: string;
  disabled?: boolean;
  onToggle: () => void;
}

interface EntryGroupHeaderProps {
  title: string;
  totalLabel?: string;
  /**
   * Turns the band into the control that selects its whole day. Only the two
   * lists that select rows pass it; a read-only band stays plain text.
   */
  selection?: EntryGroupSelection | undefined;
}

/** How much of one group is in the selection. */
export function groupSelectionState(
  ids: readonly string[],
  selectedIdSet: ReadonlySet<string>
): EntryGroupSelection["state"] {
  let selected = 0;
  for (const id of ids) {
    if (selectedIdSet.has(id)) selected += 1;
  }
  if (selected === 0) return "none";
  return selected === ids.length ? "all" : "some";
}

/**
 * The date that opens a group, with its total and the rule under it. A group
 * reads at 24px above the label and 16px below the rule: the list's own group
 * gap supplies the rest of the 24, and the bottom margin is the same gap the
 * rows inside the group keep.
 *
 * Both sides read as content, not as metadata: the day is a label at the size
 * and weight of an entry name, and its total is the app's ordinary amount — the
 * same size, weight and colour as the amounts it sums, so a day's figure is read
 * the same way wherever it appears.
 *
 * The two of them sit on the rows' own columns: a card is inset `mx-2` like this
 * band, and a row's text starts one `px-3` inside the card's 1px border, so the
 * band pads by 13px rather than 12. The rule keeps the card's full width, because
 * it is the same kind of boundary.
 *
 * While a list is selecting, the whole band is the day's own checkbox: the box
 * in front of the date carries the day's state — empty, mixed or ticked — and
 * the overlay covers the band so the tap target is the thing the user is already
 * pointing at. It stays one band in both modes; only the box and the overlay are
 * added, so nothing moves when selection starts.
 */
export function EntryGroupHeader({ title, totalLabel, selection }: EntryGroupHeaderProps) {
  return (
    <div
      className={cn(
        "relative mx-2 mb-4 border-b border-border pb-2 pt-2",
        // The hover tint goes behind the band, not over it, so pointing at a day
        // to select it does not wash the date out.
        selection != null &&
          selection.disabled !== true &&
          "rounded-md transition-colors duration-[var(--motion-feedback)] hover:bg-surface2/50",
        selection?.disabled === true && "opacity-60"
      )}
    >
      <div className="flex items-center justify-between gap-2 px-[13px]">
        <div className="flex min-w-0 items-center gap-2">
          {selection != null && <GroupSelectionBox state={selection.state} />}
          <h3 className={textRoleClassName("bodyStrong", "min-w-0 truncate")}>{title}</h3>
        </div>
        {totalLabel != null && totalLabel !== "" && (
          <AmountText variant="item" className="shrink-0">
            {totalLabel}
          </AmountText>
        )}
      </div>
      {selection != null && (
        // The same overlay the cards use: the band is one checkbox for assistive
        // tech, and the box beside the date is what says whether it is in.
        <button
          type="button"
          role="checkbox"
          aria-checked={
            selection.state === "all" ? true : selection.state === "some" ? "mixed" : false
          }
          aria-label={selection.label}
          title={selection.label}
          disabled={selection.disabled}
          onClick={selection.onToggle}
          className="absolute inset-0 cursor-pointer rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed"
        />
      )}
    </div>
  );
}

/** The day's own box, drawn like the shared `Checkbox` at the same size. */
function GroupSelectionBox({ state }: { state: EntryGroupSelection["state"] }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
        state === "none"
          ? "border-muted-foreground/40"
          : "border-primary bg-primary text-primary-foreground"
      )}
    >
      {state === "all" && <Check className="h-4 w-4" />}
      {state === "some" && <Minus className="h-4 w-4" />}
    </span>
  );
}
