"use client";
import { useCallback } from "react";
import { buildDetailsDrilldownSearchParams } from "../ledger-url-params";
import { pushLedgerUrl } from "../ledger-url-navigation";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchDetailsTabQuery } from "../prefetch-ledger-tabs";

interface UseDrilldownNavigationOptions {
  bookId?: string;
  searchParams: URLSearchParams;
  pathname: string;
  ledgerId: string;
}

interface UseDrilldownNavigationResult {
  handleCategoryDrilldown: (categoryId: string, startDate: string, endDate: string) => void;
  handleDateDrilldown: (
    date: string,
    filters?: { currency?: string | null; categoryId?: string | null }
  ) => void;
}

export function useDrilldownNavigation({
  bookId,
  searchParams,
  pathname,
  ledgerId,
}: UseDrilldownNavigationOptions): UseDrilldownNavigationResult {
  const queryClient = useQueryClient();
  const handleCategoryDrilldown = useCallback(
    (categoryId: string, startDate: string, endDate: string) => {
      const params = buildDetailsDrilldownSearchParams(searchParams, {
        startDate,
        endDate,
        categoryId,
      });
      void prefetchDetailsTabQuery(
        queryClient,
        ledgerId,
        bookId,
        { period: "custom", startDate, endDate },
        { categoryId }
      );
      pushLedgerUrl(pathname, params, "drilldown");
    },
    [bookId, ledgerId, pathname, queryClient, searchParams]
  );

  const handleDateDrilldown = useCallback(
    (date: string, filters?: { currency?: string | null; categoryId?: string | null }) => {
      const nextCategoryId = filters?.categoryId ?? null;

      const params = buildDetailsDrilldownSearchParams(searchParams, {
        startDate: date,
        endDate: date,
        categoryId: nextCategoryId,
        currency: filters?.currency ?? null,
      });
      void prefetchDetailsTabQuery(
        queryClient,
        ledgerId,
        bookId,
        { period: "custom", startDate: date, endDate: date },
        { categoryId: nextCategoryId, currency: filters?.currency ?? null }
      );
      pushLedgerUrl(pathname, params, "drilldown");
    },
    [bookId, ledgerId, pathname, queryClient, searchParams]
  );

  return {
    handleCategoryDrilldown,
    handleDateDrilldown,
  };
}
