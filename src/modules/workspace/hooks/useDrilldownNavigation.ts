"use client";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { buildDetailsDrilldownSearchParams } from "../ledger-url-params";
import { prefetchDetailsTabQuery } from "../prefetch-ledger-tabs";
import { useLedgerNavigation } from "./useLedgerNavigation";

interface UseDrilldownNavigationOptions {
  bookId?: string;
}

interface UseDrilldownNavigationResult {
  handleCategoryDrilldown: (categoryId: string, startDate: string, endDate: string) => void;
  handleDateDrilldown: (
    date: string,
    filters?: { currency?: string | null; categoryId?: string | null }
  ) => void;
}

/** 统计's way into 明细: a date range, and the category or currency that was pressed. */
export function useDrilldownNavigation({
  bookId,
}: UseDrilldownNavigationOptions): UseDrilldownNavigationResult {
  const queryClient = useQueryClient();
  const { navigate } = useLedgerNavigation();
  const handleCategoryDrilldown = useCallback(
    (categoryId: string, startDate: string, endDate: string) => {
      void prefetchDetailsTabQuery(
        queryClient,
        bookId,
        { period: "custom", startDate, endDate },
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
        { period: "custom", startDate: date, endDate: date },
        { categoryId, currency }
      );
      navigate(
        "details",
        buildDetailsDrilldownSearchParams({ startDate: date, endDate: date, categoryId, currency })
      );
    },
    [bookId, navigate, queryClient]
  );

  return {
    handleCategoryDrilldown,
    handleDateDrilldown,
  };
}
