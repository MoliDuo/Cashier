"use client";

import type { ModalItem } from "@/lib/store/modal-stack";
import { useModalStackStore } from "@/lib/store/modal-stack";
import { writeLedgerHistory } from "@/lib/navigation/ledger-history";

function setDetailParams(detail: { type: ModalItem["type"]; id: string } | null): URLSearchParams {
  const params = new URLSearchParams(window.location.search);
  if (detail == null) {
    params.delete("detailType");
    params.delete("detailId");
  } else {
    params.set("detailType", detail.type);
    params.set("detailId", detail.id);
  }
  return params;
}

function detailUrl(params: URLSearchParams): string {
  const query = params.toString();
  return query === "" ? window.location.pathname : `${window.location.pathname}?${query}`;
}

export function openLedgerDetail(item: Omit<ModalItem, "returnFocus">): void {
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  useModalStackStore.getState().push({ ...item, returnFocus } as ModalItem);
  writeLedgerHistory(
    "push",
    detailUrl(setDetailParams({ type: item.type, id: item.id })),
    "detail"
  );
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
  const params =
    previous == null
      ? setDetailParams(null)
      : setDetailParams({ type: previous.type, id: previous.id });
  const detail = new URLSearchParams(window.location.search);
  const state = window.history.state as {
    cashier?: { ledgerNavigation?: boolean; kind?: string };
  } | null;
  if (
    current != null &&
    detail.get("detailType") === current.type &&
    detail.get("detailId") === current.id &&
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
