"use client";

import { clearBookScopeCookie } from "./book-scope-cookie";
import { clearAllDrafts } from "./drafts";

/** The prefix every other key the app keeps in localStorage starts with. */
const APP_STORAGE_PREFIX = "cashier:";

/**
 * What signing out leaves behind on this device: no drafts of unsaved input,
 * no remembered book. The query cache goes with the full page load that
 * follows; the theme is the device's, not the account's, and stays.
 */
export function forgetLedgerDataOnThisDevice(): void {
  clearAllDrafts();
  clearBookScopeCookie();
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index)
    );
    for (const key of keys) {
      if (key?.startsWith(APP_STORAGE_PREFIX) === true) window.localStorage.removeItem(key);
    }
  } catch {
    // Nothing to clear where storage is unavailable.
  }
}
