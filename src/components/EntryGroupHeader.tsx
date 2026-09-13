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
 * and weight of an entry name, and its total keeps the weight and colour of
 * every other amount in the app one size down, so the band is quieter than the
 * cards without being the grey hint it used to be. The rule is the cards' own
 * border colour, because it is the same kind of boundary.
 */
export function EntryGroupHeader({ title, totalLabel }: EntryGroupHeaderProps) {
  return (
    <div className="mx-2 mb-4 flex items-center justify-between gap-2 border-b border-border pb-2 pt-2">
      <h3 className={textRoleClassName("bodyStrong", "min-w-0 truncate")}>{title}</h3>
      {totalLabel != null && totalLabel !== "" && (
        <AmountText variant="subtotal" className="shrink-0">
          {totalLabel}
        </AmountText>
      )}
    </div>
  );
}
