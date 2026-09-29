"use client";

import { useSyncExternalStore } from "react";

/** Below Tailwind's `md`, where the ledger switches to its phone layout. */
const PHONE = "(max-width: 47.99rem)";

function subscribe(callback: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function isPhone(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(PHONE).matches;
}

/**
 * Whether the viewport is a phone's. For the few places that render different
 * markup rather than different classes, such as the selection action bar that
 * replaces the tab bar. The server answers false: nothing it renders is
 * selecting.
 */
export function useIsPhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, isPhone, () => false);
}
