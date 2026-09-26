"use client";

export type LedgerNavigationKind = "tab" | "filter" | "stats" | "drilldown" | "detail";

interface CashierHistoryMetadata {
  cashier?: {
    ledgerNavigation: true;
    kind: LedgerNavigationKind;
  };
}

function currentCustomHistoryState(): Record<string, unknown> {
  const state = window.history.state;
  if (state == null || typeof state !== "object" || Array.isArray(state)) {
    return {};
  }

  const customState = { ...(state as Record<string, unknown>) };
  delete customState.__NA;
  delete customState._N;
  delete customState.__PRIVATE_NEXTJS_INTERNALS_TREE;
  return customState;
}

/** Writes a ledger URL, marking the entry so a detail sheet knows it pushed it. */
export function writeLedgerHistory(
  method: "push" | "replace",
  url: string,
  kind: LedgerNavigationKind
): void {
  const state: Record<string, unknown> & CashierHistoryMetadata = {
    ...currentCustomHistoryState(),
    cashier: { ledgerNavigation: true, kind },
  };
  if (method === "push") window.history.pushState(state, "", url);
  else window.history.replaceState(state, "", url);
}
