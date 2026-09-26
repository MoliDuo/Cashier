"use client";

import { createContext, useContext } from "react";
import type { BookDto, EntryCategoryWithCount, LedgerDto } from "@/modules/ledger/contracts";
import type { RecordScope } from "@/modules/ledger/filters";

/** What every ledger route renders against, resolved once by the shared layout. */
export interface LedgerWorkspaceValue {
  ledger: LedgerDto;
  books: readonly BookDto[];
  categories: EntryCategoryWithCount[];
  /** The book being viewed, or null for 总账. */
  recordScope: RecordScope;
  effectiveTimeZone: string | undefined;
  /**
   * False while the reader's zone is still unknown. The date-driven routes then
   * show their skeleton instead of mounting a query for the wrong day.
   */
  timeZoneReady: boolean;
  /** Today in the page's zone as the server dated it, when it could. */
  ledgerToday: string | undefined;
}

export const LedgerWorkspaceContext = createContext<LedgerWorkspaceValue | null>(null);

export function useLedgerWorkspace(): LedgerWorkspaceValue {
  const value = useContext(LedgerWorkspaceContext);
  if (value == null) throw new Error("useLedgerWorkspace must be used within LedgerWorkspace");
  return value;
}
