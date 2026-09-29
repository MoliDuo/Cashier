"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { syncLedgerAfterWrite } from "@/lib/mutations/ledger-sync";

/**
 * A tap on the tab already open: the page goes back to its top and every ledger
 * query on screen reads again, the way a write catches up. A tap while one
 * refresh is still reading does not start another.
 */
export function useTabRefresh(): { refreshing: boolean; refresh: () => void } {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    window.scrollTo({ top: 0, left: 0, behavior: reduceMotion ? "auto" : "smooth" });
    // A query that fails shows its own error where it is rendered.
    void syncLedgerAfterWrite(queryClient)
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = false;
        setRefreshing(false);
      });
  }, [queryClient]);

  return { refreshing, refresh };
}
