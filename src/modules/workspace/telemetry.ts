import { track } from "@/lib/telemetry/client";
import type { Period } from "@/modules/ledger/domain/period";
import type { EntryFilters } from "@/modules/ledger/filters";

/** `period.switch` for a period just chosen: its kind and offset, never a custom range's days. */
export function trackPeriodSwitch(tab: "entries" | "stats", period: Period): void {
  track("period.switch", {
    tab,
    range: period.range,
    ...("offset" in period ? { offset: period.offset } : {}),
  });
}

/** `filter.apply` for applied filters: which are set, never their values (a search is user text). */
export function trackFilterApply(filters: EntryFilters): void {
  const fields = Object.entries(filters)
    .filter(([, value]) => value != null && !(Array.isArray(value) && value.length === 0))
    .map(([key]) => key);
  track("filter.apply", { fields, count: fields.length });
}
