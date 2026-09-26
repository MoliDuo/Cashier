"use client";

import { useSyncExternalStore } from "react";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";

const subscribeNever = () => () => {};

/** False on the server and in browsers without WebAuthn, so passkey controls only work where they can. */
export function usePasskeySupport(): boolean {
  return useSyncExternalStore(subscribeNever, browserSupportsWebAuthn, () => false);
}

/** A dismissed or timed-out browser prompt, which needs no error message. */
export function isCancelledCeremony(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError")
  );
}
