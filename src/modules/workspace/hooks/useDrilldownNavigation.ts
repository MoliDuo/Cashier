"use client";
import { useCallback } from "react";
import { buildDetailsDrilldownSearchParams } from "../ledger-url-params";
import { pushLedgerUrl } from "../ledger-url-navigation";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchDetailsTabQuery } from "../prefetch-ledger-tabs";

interface UseDrilldownNavigationOptions {
  attributedUserId?: string;
  searchParams: URLSearchParams;
  pathname: string;
  ledgerId: string;
  /** The viewer, whose own zone the prefetched details page is dated by. */
  userId: string;
  locale: string;
}

interface UseDrilldownNavigationResult {
  handleCategoryDrilldown: (categoryId: string, startDate: string, endDate: string) => void;
  handleDateDrilldown: (
    date: string,
    filters?: { currency?: string | null; categoryId?: string | null }
  ) => void;
}

export function useDrilldownNavigation({
  attributedUserId,
  searchParams,
  pathname,
  ledgerId,
  userId,
  locale,
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
        userId,
        { period: "custom", startDate, endDate },
        { categoryId },
        attributedUserId
      );
      pushLedgerUrl(pathname, params, locale, "drilldown");
    },
    [attributedUserId, ledgerId, locale, pathname, queryClient, searchParams, userId]
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
        userId,
        { period: "custom", startDate: date, endDate: date },
        { categoryId: nextCategoryId, currency: filters?.currency ?? null },
        attributedUserId
      );
      pushLedgerUrl(pathname, params, locale, "drilldown");
    },
    [attributedUserId, ledgerId, locale, pathname, queryClient, searchParams, userId]
  );

  return {
    handleCategoryDrilldown,
    handleDateDrilldown,
  };
}
