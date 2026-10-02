"use client";
import { useReportWebVitals } from "next/web-vitals";
import { reportWebVital } from "@/lib/telemetry/client";

/** Hands Next's web-vitals measurements (LCP, INP, CLS, FCP, TTFB) to telemetry. Renders nothing. */
export function TelemetryVitals(): null {
  useReportWebVitals(reportWebVital);
  return null;
}
