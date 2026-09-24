"use client";

import { useEffect, useRef } from "react";
import { normalizeLedgerUrlSearchParams, readLedgerDetailSearchParams } from "../ledger-url-params";
import { replaceLedgerUrl } from "../ledger-url-navigation";
import { writeLedgerHistory } from "@/lib/navigation/ledger-history";
import { registerLedgerHistoryTraversal } from "@/lib/navigation/ledger-history-traversal";
import { useModalStackStore } from "@/lib/store/modal-stack";
import { useUnsavedChangesStore, type UnsavedChangesLeaveGuard } from "@/lib/store/unsaved-changes";

interface UseLedgerHistorySyncOptions {
  pathname: string;
  searchParams: URLSearchParams;
  ledgerId: string;
}

export function useLedgerHistorySync({
  pathname,
  searchParams,
  ledgerId,
}: UseLedgerHistorySyncOptions): void {
  const blockSyncRef = useRef(false);
  const restoringRef = useRef(false);
  const bypassRef = useRef(false);
  const pendingGuardRef = useRef<UnsavedChangesLeaveGuard | null>(null);
  const pendingSpanRef = useRef(0);
  const sequenceRef = useRef<number | null>(null);

  useEffect(() => {
    const state = window.history.state as { cashier?: { sequence?: number } } | null;
    if (!Number.isInteger(state?.cashier?.sequence)) {
      writeLedgerHistory("replace", window.location.href, "filter");
    }
    const sequence = (window.history.state as { cashier?: { sequence?: number } } | null)?.cashier
      ?.sequence;
    sequenceRef.current = Number.isInteger(sequence) ? sequence! : null;
  }, [pathname, searchParams]);

  useEffect(() => {
    const next = normalizeLedgerUrlSearchParams(searchParams);
    if (next != null && next.toString() !== searchParams.toString()) {
      replaceLedgerUrl(pathname, next);
    }
  }, [pathname, searchParams]);

  useEffect(() => {
    if (blockSyncRef.current) {
      // Restoring browser history and updating the router's search params are
      // separate events. Do not unmount a dirty editor between them.
      if (
        restoringRef.current ||
        searchParams.toString() !== new URLSearchParams(window.location.search).toString()
      )
        return;
      blockSyncRef.current = false;
    }
    const detail = readLedgerDetailSearchParams(searchParams);
    useModalStackStore.getState().syncToDetail(
      detail == null
        ? null
        : {
            type: detail.detailType,
            id: detail.detailId,
            ledgerId,
            returnFocus: null,
          }
    );
  }, [ledgerId, searchParams]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const targetSequence = (event.state as { cashier?: { sequence?: number } } | null)?.cashier
        ?.sequence;
      const sourceSequence = sequenceRef.current;
      const span =
        Number.isInteger(sourceSequence) && Number.isInteger(targetSequence)
          ? sourceSequence! - targetSequence!
          : 0;
      sequenceRef.current = Number.isInteger(targetSequence) ? targetSequence! : null;
      if (bypassRef.current) {
        bypassRef.current = false;
        return;
      }

      if (restoringRef.current) {
        event.stopImmediatePropagation();
        restoringRef.current = false;
        const guard = pendingGuardRef.current;
        pendingGuardRef.current = null;
        guard?.requestLeave(() => {
          bypassRef.current = true;
          window.history.go(-pendingSpanRef.current);
        });
        return;
      }

      const top = useModalStackStore.getState().stack.at(-1);
      const retryGuard = useUnsavedChangesStore
        .getState()
        .getLeaveGuard("source-document-retry-navigation");
      if (retryGuard != null && span !== 0) {
        event.stopImmediatePropagation();
        blockSyncRef.current = true;
        restoringRef.current = true;
        pendingGuardRef.current = retryGuard;
        pendingSpanRef.current = span;
        window.history.go(span);
        return;
      }
      if (top == null) {
        const guards = useUnsavedChangesStore.getState();
        const settingsGuard =
          guards.getLeaveGuard("new-record-navigation") ??
          guards.getLeaveGuard("settings-navigation");
        if (settingsGuard == null || span === 0) return;
        event.stopImmediatePropagation();
        blockSyncRef.current = true;
        restoringRef.current = true;
        pendingGuardRef.current = settingsGuard;
        pendingSpanRef.current = span;
        window.history.go(span);
        return;
      }
      const destination = readLedgerDetailSearchParams(new URLSearchParams(window.location.search));
      if (destination?.detailType === top.type && destination.detailId === top.id) {
        return;
      }

      const guardKey = `${top.type}-detail:${top.ledgerId}:${top.id}`;
      const guard = useUnsavedChangesStore.getState().getLeaveGuard(guardKey);
      if (guard == null || span === 0) return;
      event.stopImmediatePropagation();

      blockSyncRef.current = true;
      restoringRef.current = true;
      pendingGuardRef.current = guard;
      pendingSpanRef.current = span;
      window.history.go(span);
    };

    return registerLedgerHistoryTraversal(handlePopState);
  }, []);
}
