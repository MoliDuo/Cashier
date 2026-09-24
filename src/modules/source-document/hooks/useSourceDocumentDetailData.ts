"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SourceDocumentResultDto } from "../contracts";
import { queryKeys } from "@/lib/query-keys";
import { getSourceDocumentLightAction } from "@/lib/queries/ledger-query-client";
import { QUERY } from "@/lib/constants";
import { withQueryTimeout } from "@/lib/query-timeout";
import { useLedgerRefreshPolling } from "./useLedgerRefreshPolling";

interface UseSourceDocumentDetailDataOptions {
  ledgerId: string;
  id: string;
  open: boolean;
}

export function useSourceDocumentDetailData({
  ledgerId,
  id,
  open,
}: UseSourceDocumentDetailDataOptions) {
  const queryClient = useQueryClient();
  const key = queryKeys.sourceDocument(ledgerId, id);
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const incoming = await withQueryTimeout(getSourceDocumentLightAction(ledgerId, id));
      const current = queryClient.getQueryData<SourceDocumentResultDto>(key);
      return incoming != null && current != null && current.version > incoming.version
        ? current
        : incoming;
    },
    enabled: open && id !== "",
    staleTime: QUERY.SOURCE_DOC_STALE_TIME_MS,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { data: sourceDocument, isLoading, error } = query;

  useLedgerRefreshPolling(ledgerId, open && id !== "");

  const currentLedgerEntries = sourceDocument?.ledgerEntries ?? [];
  const isLoadingImages =
    sourceDocument != null &&
    sourceDocument.hasImages === true &&
    sourceDocument.files.length === 0;

  return {
    sourceDocument: sourceDocument ?? null,
    currentLedgerEntries,
    ledgerId: sourceDocument?.ledgerId ?? ledgerId,
    isLoading,
    isLoadingImages,
    error,
    refetch: query.refetch,
  };
}
