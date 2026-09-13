import { EntryGroupHeader, groupSelectionState } from "@/components/EntryGroupHeader";
import { formatRelativeDateLabel } from "@/lib/date-utils";
import { formatCurrencyAmount } from "@/lib/format/currency";
import type { UnifiedStreamGroup } from "@/modules/source-document/stream-grouping";
import { useLocale, useTranslations } from "next-intl";

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
  const locale = useLocale();
  const t = useTranslations("SourceDocumentCard");
  const tBatch = useTranslations("BatchActions");
  const tCommon = useTranslations("Common");
  const dateLabel =
    group.dateProvenance === "unknown"
      ? t("dateUnknown")
      : formatRelativeDateLabel(
          group.date,
          locale,
          { today: tCommon("today"), yesterday: tCommon("yesterday") },
          timeZone
        );
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
                  ? tBatch("deselectDay", { date: dateLabel })
                  : tBatch("selectDay", { date: dateLabel }),
              onToggle: () => selection.onSelectMany(selection.ids, state !== "all"),
            },
          })}
    />
  );
}
