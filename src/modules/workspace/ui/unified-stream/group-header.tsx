import { EntryGroupHeader, groupSelectionState } from "@/components/EntryGroupHeader";
import { formatRelativeDateLabel } from "@/lib/date-utils";
import { formatCurrencyAmount } from "@/lib/format/currency";
import type { UnifiedStreamGroup } from "@/modules/source-document/stream-grouping";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { sourceDocumentCardCopy } from "@/copy/source-document";
import { batchActionsCopy } from "@/copy/workspace";

export interface UnifiedGroupHeaderSelection {
  /** The day's own cards, in list order. */
  ids: readonly string[];
  selectedIdSet: ReadonlySet<string>;
  /** Set when the batch limit is reached, so an untouched day cannot start one. */
  disabled: boolean;
  onSelectMany: (ids: readonly string[], selected: boolean) => void;
}

export function UnifiedGroupHeader({
  group,
  mainCurrency,
  timeZone,
  selection,
}: {
  group: UnifiedStreamGroup;
  mainCurrency: string;
  timeZone?: string;
  selection?: UnifiedGroupHeaderSelection | undefined;
}) {
  const locale = DISPLAY_LOCALE;
  const dateLabel =
    group.dateProvenance === "unknown"
      ? sourceDocumentCardCopy.dateUnknown
      : formatRelativeDateLabel(group.date, locale, timeZone);
  const state =
    selection == null ? null : groupSelectionState(selection.ids, selection.selectedIdSet);

  return (
    <EntryGroupHeader
      title={dateLabel}
      totalLabel={formatCurrencyAmount(group.total, mainCurrency, locale)}
      {...(selection == null || state == null
        ? {}
        : {
            selection: {
              state,
              disabled: selection.disabled && state === "none",
              label:
                state === "all"
                  ? batchActionsCopy.deselectDay({ date: dateLabel })
                  : batchActionsCopy.selectDay({ date: dateLabel }),
              onToggle: () => selection.onSelectMany(selection.ids, state !== "all"),
            },
          })}
    />
  );
}
