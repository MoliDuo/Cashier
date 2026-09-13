"use client";

import { useSyncExternalStore } from "react";

/**
 * "Coarse pointer, no hover" means the primary input is a finger.
 *
 * A laptop with a touchscreen still reports a fine, hovering primary pointer,
 * and an iPad with a keyboard case attached still reports the touchscreen, so
 * this separates phones and tablets from desktops without sniffing the agent
 * string.
 */
const QUERY = "(hover: none) and (pointer: coarse)";

function subscribe(callback: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

export function useIsTouchInput(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
