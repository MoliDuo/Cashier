"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SourceDocumentDetailDto } from "../contracts";
import { queryKeys } from "@/lib/query-keys";
import { getSourceDocumentDetailAction } from "@/lib/queries/ledger-query-client";
import { QUERY } from "@/lib/constants";
import { useLedgerRefreshPolling } from "./useLedgerRefreshPolling";

interface UseSourceDocumentDetailDataOptions {
  id: string;
  open: boolean;
}

export function useSourceDocumentDetailData({ id, open }: UseSourceDocumentDetailDataOptions) {
  const queryClient = useQueryClient();
  const key = queryKeys.sourceDocument(id);
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const incoming = await getSourceDocumentDetailAction(id);
      const current = queryClient.getQueryData<SourceDocumentDetailDto>(key);
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

  useLedgerRefreshPolling(open && id !== "");

  const currentLedgerEntries = sourceDocument?.ledgerEntries ?? [];
  return {
    sourceDocument: sourceDocument ?? null,
    currentLedgerEntries,
    isLoading,
    error,
    refetch: query.refetch,
  };
}
