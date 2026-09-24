"use client";
import { useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ActiveLedgerEntryDto } from "@/modules/ledger/contracts";
import { formatDateTimeForApi } from "@/lib/date-utils";
import { useDateGrouping } from "@/hooks/use-date-grouping";

export interface GroupedEntry {
  title: string;
  timestamp: number;
  items: ActiveLedgerEntryDto[];
  total: string;
}

export interface UseDetailsTabGroupingReturn {
  groupedItems: GroupedEntry[];
  getDateStr: (entry: ActiveLedgerEntryDto) => string;
}

export function useDetailsTabGrouping(
  entries: ActiveLedgerEntryDto[],
  timeZone?: string
): UseDetailsTabGroupingReturn {
  const t = useTranslations("DetailsTab");
  const locale = useLocale();

  const getDateStr = useCallback((entry: ActiveLedgerEntryDto) => {
    if (entry.sourceDocument.documentDate != null && entry.sourceDocument.documentDate !== "") {
      return entry.sourceDocument.documentDate;
    }
    return formatDateTimeForApi(new Date(entry.createdAt)) ?? formatDateTimeForApi(new Date())!;
  }, []);
  const getAmount = useCallback(
    (entry: ActiveLedgerEntryDto) => (entry.convertedAmount != null ? entry.convertedAmount : "0"),
    []
  );

  const { groupedItems } = useDateGrouping({
    items: entries,
    getDateStr,
    getAmount,
    locale,
    t,
    preserveOrder: true,
    ...(timeZone != null ? { timeZone } : {}),
  });

  return { groupedItems, getDateStr };
}
