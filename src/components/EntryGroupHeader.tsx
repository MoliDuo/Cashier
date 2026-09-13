import { AmountText } from "@/modules/currency/ui/amount-text";
import { textRoleClassName } from "@/components/typography";

interface EntryGroupHeaderProps {
  title: string;
  totalLabel?: string;
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
 */
export function EntryGroupHeader({ title, totalLabel }: EntryGroupHeaderProps) {
  return (
    <div className="mx-2 mb-4 flex items-center justify-between gap-2 border-b border-border px-[13px] pb-2 pt-2">
      <h3 className={textRoleClassName("bodyStrong", "min-w-0 truncate")}>{title}</h3>
      {totalLabel != null && totalLabel !== "" && (
        <AmountText variant="item" className="shrink-0">
          {totalLabel}
        </AmountText>
      )}
    </div>
  );
}
