"use client";

import { writeLedgerHistory } from "@/lib/navigation/ledger-history";

/** The open record, as `?detail=<id>` on whichever ledger route it was opened from. */
export const LEDGER_DETAIL_PARAM = "detail";

export function readLedgerDetailParam(params: Pick<URLSearchParams, "get">): string | null {
  const id = params.get(LEDGER_DETAIL_PARAM);
  return id == null || id === "" ? null : id;
}

function detailUrl(id: string | null): string {
  const params = new URLSearchParams(window.location.search);
  if (id == null) params.delete(LEDGER_DETAIL_PARAM);
  else params.set(LEDGER_DETAIL_PARAM, id);
  const query = params.toString();
  return query === "" ? window.location.pathname : `${window.location.pathname}?${query}`;
}

/** Whether the current history entry is one a detail sheet pushed. */
function detailWasPushed(): boolean {
  const state = window.history.state as { cashier?: { kind?: string } } | null;
  return state?.cashier?.kind === "detail";
}

// The control that opened the sheet, so closing it puts focus back there. It
// is interface state only; the URL stays the one record of what is open.
let returnFocusTarget: HTMLElement | null = null;

/**
 * Opens a record. A sheet already open is replaced rather than stacked, so
 * closing always lands back on the list it was opened from.
 */
export function openLedgerDetail(id: string): void {
  const current = readLedgerDetailParam(new URLSearchParams(window.location.search));
  if (current == null) {
    returnFocusTarget =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    writeLedgerHistory("push", detailUrl(id), "detail");
    return;
  }
  if (current === id) return;
  writeLedgerHistory("replace", detailUrl(id), detailWasPushed() ? "detail" : "filter");
}

/**
 * A ledger entry has no detail sheet of its own, so opening one lands on the
 * record it belongs to — the sheet the stream card opens. Entries are stored
 * with a source document, so the guard only covers a malformed payload.
 */
export function openLedgerEntrySourceDocument(entry: { sourceDocumentId: string | null }): void {
  if (entry.sourceDocumentId == null || entry.sourceDocumentId === "") return;
  openLedgerDetail(entry.sourceDocumentId);
}

/**
 * Closes the open record the way Back would: an entry the sheet pushed is
 * popped, and a sheet reached by a link has its parameter replaced away.
 */
export function closeLedgerDetail(): void {
  if (readLedgerDetailParam(new URLSearchParams(window.location.search)) == null) return;
  if (detailWasPushed()) {
    window.history.back();
    return;
  }
  writeLedgerHistory("replace", detailUrl(null), "filter");
}

/** Hands focus back to the control that opened the sheet, once it has gone. */
export function restoreDetailReturnFocus(): void {
  const target = returnFocusTarget;
  returnFocusTarget = null;
  window.requestAnimationFrame(() => {
    if (target?.isConnected === true) target.focus();
    else document.querySelector<HTMLElement>("[data-ledger-focus-fallback]")?.focus();
  });
}
