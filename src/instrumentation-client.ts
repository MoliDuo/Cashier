import { startTelemetry, trackScreenTransition } from "@/lib/telemetry/client";

// Runs in the browser before the app hydrates. Without INSIGHT_URL and
// INSIGHT_KEY at build time this starts nothing.
startTelemetry();

/** Next calls this when a navigation starts; each one is a `$screen`. */
export function onRouterTransitionStart(
  url: string,
  navigationType: "push" | "replace" | "traverse"
): void {
  trackScreenTransition(url, navigationType);
}
