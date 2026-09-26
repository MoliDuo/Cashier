"use client";

import type { ModalItem } from "@/lib/store/modal-stack";
import { useModalStackStore } from "@/lib/store/modal-stack";
import { writeLedgerHistory } from "@/lib/navigation/ledger-history";

/** The open record, as `?detail=<id>` on whichever ledger route it was opened from. */
export const LEDGER_DETAIL_PARAM = "detail";

export function readLedgerDetailParam(params: Pick<URLSearchParams, "get">): string | null {
  const id = params.get(LEDGER_DETAIL_PARAM);
  return id == null || id === "" ? null : id;
}

function setDetailParams(detail: { id: string } | null): URLSearchParams {
  const params = new URLSearchParams(window.location.search);
  if (detail == null) params.delete(LEDGER_DETAIL_PARAM);
  else params.set(LEDGER_DETAIL_PARAM, detail.id);
  return params;
}

function detailUrl(params: URLSearchParams): string {
  const query = params.toString();
  return query === "" ? window.location.pathname : `${window.location.pathname}?${query}`;
}

export function openLedgerDetail(item: Omit<ModalItem, "returnFocus">): void {
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  useModalStackStore.getState().push({ ...item, returnFocus } as ModalItem);
  writeLedgerHistory("push", detailUrl(setDetailParams({ id: item.id })), "detail");
}

/**
 * A ledger entry has no detail sheet of its own, so opening one lands on the
 * record it belongs to — the sheet the stream card opens. Entries are stored
 * with a source document, so the guard only covers a malformed payload.
 */
export function openLedgerEntrySourceDocument(entry: { sourceDocumentId: string | null }): void {
  if (entry.sourceDocumentId == null || entry.sourceDocumentId === "") return;
  openLedgerDetail({
    type: "source-document",
    id: entry.sourceDocumentId,
  });
}

export function closeLedgerDetail(): void {
  const modalState = useModalStackStore.getState();
  const current = modalState.stack.at(-1);
  const previous = modalState.stack.at(-2);
  const params = setDetailParams(previous == null ? null : { id: previous.id });
  const detail = new URLSearchParams(window.location.search);
  const state = window.history.state as {
    cashier?: { ledgerNavigation?: boolean; kind?: string };
  } | null;
  if (
    current != null &&
    readLedgerDetailParam(detail) === current.id &&
    state?.cashier?.ledgerNavigation === true &&
    state.cashier.kind === "detail"
  ) {
    window.history.back();
    return;
  }
  writeLedgerHistory("replace", detailUrl(params), "detail");
  if (previous == null) modalState.closeAll();
  else modalState.pop();
}
