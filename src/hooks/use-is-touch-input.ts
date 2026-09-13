"use client";

import { useSyncExternalStore } from "react";

/** The primary pointer is a finger. */
const COARSE = "(pointer: coarse)";
/** A mouse or trackpad is driving, so a webcam is not the gesture. */
const DESKTOP_LIKE = "(hover: hover) and (pointer: fine)";

function isTouchPrimary(): boolean {
  if (window.matchMedia(COARSE).matches) return true;
  // Some devices report a fine primary pointer while still being a phone or
  // tablet — a mouse paired to one, say. Touch points settle it, unless the
  // device is also hovering, which is a laptop with a touchscreen and a
  // trackpad, and there the camera is not wanted.
  return navigator.maxTouchPoints > 0 && !window.matchMedia(DESKTOP_LIKE).matches;
}

function subscribe(callback: () => void): () => void {
  const queries = [window.matchMedia(COARSE), window.matchMedia(DESKTOP_LIKE)];
  queries.forEach((query) => query.addEventListener("change", callback));
  return () => queries.forEach((query) => query.removeEventListener("change", callback));
}

export function useIsTouchInput(): boolean {
  return useSyncExternalStore(subscribe, isTouchPrimary, () => false);
}
