"use client";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLedgerNavigation } from "../../hooks/useLedgerNavigation";
import { buildDetailsDrilldownSearchParams } from "../../ledger-url-params";
import { prefetchDetailsTabQuery } from "../../prefetch-ledger-tabs";
import { StatsTab } from "../StatsTab";
import { useLedgerWorkspace } from "../ledger-workspace-context";

/** 统计: totals over a period, each of which drills down into 明细. */
export function StatsRoute() {
  const { ledger, recordScope, timeZone, today } = useLedgerWorkspace();
  const queryClient = useQueryClient();
  const { navigate } = useLedgerNavigation();
  const bookId = recordScope ?? undefined;

  // 统计's way into 明细: a date range, and the category or currency that was pressed.
  const handleCategoryDrilldown = useCallback(
    (categoryId: string, startDate: string, endDate: string) => {
      void prefetchDetailsTabQuery(
        queryClient,
        bookId,
        { range: "custom", from: startDate, to: endDate },
        { categoryId }
      );
      navigate("details", buildDetailsDrilldownSearchParams({ startDate, endDate, categoryId }));
    },
    [bookId, navigate, queryClient]
  );

  const handleDateDrilldown = useCallback(
    (date: string, filters?: { currency?: string | null; categoryId?: string | null }) => {
      const categoryId = filters?.categoryId ?? null;
      const currency = filters?.currency ?? null;
      void prefetchDetailsTabQuery(
        queryClient,
        bookId,
        { range: "custom", from: date, to: date },
        { categoryId, currency }
      );
      navigate(
        "details",
        buildDetailsDrilldownSearchParams({ startDate: date, endDate: date, categoryId, currency })
      );
    },
    [bookId, navigate, queryClient]
  );

  return (
    <StatsTab
      bookId={bookId}
      ledger={ledger}
      today={today}
      timeZone={timeZone}
      onCategoryDrilldown={handleCategoryDrilldown}
      onDateDrilldown={handleDateDrilldown}
    />
  );
}
