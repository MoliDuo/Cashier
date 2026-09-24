"use client";
import { useCallback } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import type { LedgerTab } from "@/lib/ledger-tabs";

/** The shell owns refresh commands, while each tab owns its query presentation. */
export function useActiveTabQueryState({ activeTab }: { activeTab: LedgerTab }) {
  const queryClient = useQueryClient();
  const matchesActiveTab = useCallback(
    (query: { queryKey: readonly unknown[] }) => {
      const key = query.queryKey;
      if (key[0] !== "ledger") return false;
      if (activeTab === "stream") {
        return key[1] === "source-documents" && (key[2] === "stream" || key[2] === "stream-total");
      }
      if (activeTab === "details") return key[1] === "entries" || key[1] === "summary";
      if (activeTab === "stats") return key[1] === "enhanced-stats";
      // 设置 owns the ledger itself, its categories, its settings and both book
      // lists — the switcher's live one and the archived-inclusive one the 分账
      // section reads — so a refresh has to cover every one of them.
      return (
        key.length === 1 || key[1] === "categories" || key[1] === "settings" || key[1] === "books"
      );
    },
    [activeTab]
  );
  const fetchingCount = useIsFetching({ predicate: matchesActiveTab });
  const refreshActiveTab = useCallback(async () => {
    await queryClient.refetchQueries(
      { predicate: matchesActiveTab, type: "active" },
      { throwOnError: true }
    );
  }, [matchesActiveTab, queryClient]);
  return { isRefreshing: fetchingCount > 0, refreshActiveTab };
}
