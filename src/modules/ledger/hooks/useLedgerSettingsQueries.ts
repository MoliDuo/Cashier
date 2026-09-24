"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSmartPolling } from "@/hooks/use-smart-polling";
import { queryKeys } from "@/lib/query-keys";
import {
  getEntryCategoriesAction,
  getLedgerAction,
  getLedgerSettingsAction,
} from "@/lib/queries/ledger-query-client";
import type { EntryCategoryWithCount, Ledger, ServiceCredential } from "@/modules/ledger/contracts";
import { LEDGER } from "@/lib/constants";

interface UseLedgerSettingsQueriesParams {
  initialLedger: Ledger;
  initialCategories: EntryCategoryWithCount[];
  metadataPollingSession: number;
}

export function useLedgerSettingsQueries({
  initialLedger,
  initialCategories,
  metadataPollingSession,
}: UseLedgerSettingsQueriesParams) {
  type QueryStatus = "pending" | "success" | "error";
  const settingsQueryKey = queryKeys.ledgerSettings();
  const categoryMetadataPolling = useSmartPolling<EntryCategoryWithCount[]>({
    sessionKey: metadataPollingSession,
    isPollingActive: useCallback(
      (data) =>
        data?.some(
          (category) =>
            category.icon == null ||
            category.icon === "" ||
            category.description == null ||
            category.description === ""
        ) ?? false,
      []
    ),
  });

  const ledgerQuery = useQuery<Ledger | null>({
    queryKey: queryKeys.ledger(),
    queryFn: () => getLedgerAction(),
    initialData: initialLedger,
    staleTime: LEDGER.STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });
  const ledger = ledgerQuery.data ?? initialLedger;

  const categoriesQuery = useQuery<EntryCategoryWithCount[]>({
    queryKey: queryKeys.entryCategories(),
    queryFn: () => getEntryCategoriesAction(),
    initialData: initialCategories,
    refetchInterval: categoryMetadataPolling,
    staleTime: LEDGER.STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });
  const categories = categoriesQuery.data ?? initialCategories;

  const settingsQuery = useQuery<{
    uncategorizedCount: number;
    credentials: ServiceCredential[];
  }>({
    queryKey: settingsQueryKey,
    queryFn: () => getLedgerSettingsAction(),
    staleTime: LEDGER.STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });
  const { data: settingsData } = settingsQuery;
  const ledgerStatus = ledgerQuery.status as QueryStatus;
  const categoriesStatus = categoriesQuery.status as QueryStatus;
  const aggregateStatus = settingsQuery.status as QueryStatus;
  const settingsQueryStatus: QueryStatus =
    ledgerStatus === "error" || categoriesStatus === "error" || aggregateStatus === "error"
      ? "error"
      : ledgerStatus === "pending" ||
          categoriesStatus === "pending" ||
          aggregateStatus === "pending"
        ? "pending"
        : "success";

  return {
    ledger,
    categories,
    uncategorizedCount: settingsData?.uncategorizedCount ?? 0,
    credentials: settingsData?.credentials ?? [],
    settingsQueryStatus,
  };
}
