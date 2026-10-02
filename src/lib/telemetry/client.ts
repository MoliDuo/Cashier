import {
  init,
  reportVital,
  startOp,
  track as sdkTrack,
  trackDialog as sdkTrackDialog,
  trackScreen,
  type ScreenVia,
  type VitalMetric,
} from "@moli-insight/web";
import type { TelemetryEventMap, TelemetryEventName } from "./events";

/**
 * The browser side of telemetry, and the only module feature code imports it
 * from. Every function does nothing until `startTelemetry` has run, and that
 * only runs when the build has INSIGHT_URL and INSIGHT_KEY set, so development,
 * tests and unconfigured deployments stay silent and make no network calls.
 * Nothing here throws: telemetry must never break the page it observes.
 */

/** Inlined by next.config.ts from the presence of INSIGHT_URL and INSIGHT_KEY. */
export function isTelemetryEnabled(): boolean {
  return process.env.NEXT_PUBLIC_INSIGHT_ENABLED === "true";
}

/** The relay every batch goes through; the key stays on the server. */
export const TELEMETRY_ENDPOINT = "/api/telemetry";

let started = false;
let lastScreen: string | null = null;

/**
 * Starts the SDK once. Its automatic capture is off except `$visibility`, which
 * feeds usage time: `$tap`, `$rage_tap` and `$dead_tap` name the clicked element
 * by its `aria-label`, which here can be a book or category name, and `$error`
 * carries a message that can quote user input. `$screen` is left to
 * `trackScreenTransition`, and errors to the boundary in `app/error.tsx`.
 */
export function startTelemetry(): void {
  if (started || !isTelemetryEnabled() || typeof window === "undefined") return;
  started = true;
  try {
    init({
      endpoint: TELEMETRY_ENDPOINT,
      release: process.env.NEXT_PUBLIC_GIT_SHA ?? "dev",
      autoCapture: { taps: false, rage: false, dead: false, errors: false, screens: false },
    });
    lastScreen = window.location.pathname;
    trackScreen(lastScreen, "app");
  } catch {
    // Telemetry is best effort.
  }
}

/** Records one business event. */
export function track<N extends TelemetryEventName>(name: N, props: TelemetryEventMap[N]): void {
  try {
    sdkTrack(name, props);
  } catch {
    // Telemetry is best effort.
  }
}

const SCREEN_VIA: Record<"push" | "replace" | "traverse", ScreenVia> = {
  push: "push",
  replace: "replace",
  traverse: "back",
};

/**
 * `$screen` for a router transition, by path only: a query string can carry a
 * callback address or a filter. A move that keeps the path is not a new screen.
 */
export function trackScreenTransition(
  url: string,
  navigationType: "push" | "replace" | "traverse"
): void {
  try {
    const path = new URL(url, "http://local").pathname;
    if (path === lastScreen) return;
    lastScreen = path;
    trackScreen(path, SCREEN_VIA[navigationType]);
  } catch {
    // Telemetry is best effort.
  }
}

/** Hands a web-vitals metric to `$vital`. */
export function reportWebVital(metric: { name: string; value: number; rating?: string }): void {
  const names: readonly string[] = ["LCP", "INP", "CLS", "FCP", "TTFB"];
  if (!names.includes(metric.name)) return;
  try {
    reportVital({
      name: metric.name as VitalMetric["name"],
      value: metric.value,
      ...(metric.rating === "good" ||
      metric.rating === "needs-improvement" ||
      metric.rating === "poor"
        ? { rating: metric.rating }
        : {}),
    });
  } catch {
    // Telemetry is best effort.
  }
}

/** Times an operation; `end` records `$op`. The handle is inert when telemetry is off. */
export function startOperation(op: string): {
  succeed: () => void;
  fail: (errorKind: string) => void;
} {
  let handle: ReturnType<typeof startOp> | null = null;
  try {
    handle = startOp(op);
  } catch {
    // Telemetry is best effort.
  }
  return {
    succeed: () => handle?.end({ ok: true }),
    fail: (errorKind) => handle?.end({ ok: false, errorKind }),
  };
}

/** `$dialog` for a named dialog opening or closing. */
export function trackDialog(name: string, action: "open" | "close", closeBy?: string): void {
  try {
    sdkTrackDialog(name, action, closeBy == null ? undefined : { closeBy });
  } catch {
    // Telemetry is best effort.
  }
}

/** A short code for what failed, never the message: `AppError` codes, else the error's name. */
export function errorKindOf(error: unknown): string {
  if (typeof error === "object" && error != null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code !== "") return code.slice(0, 64);
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && name !== "") return name.slice(0, 64);
  }
  return "unknown";
}
