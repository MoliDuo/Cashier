import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATS_RANGE_TYPE,
  getStatsInitialQueryState,
} from "@/modules/workspace/initial-query-state";
import { buildDetailsFilterKey, getDetailsInitialQueryState } from "@/modules/ledger/ledger-query";

describe("initial ledger query state helpers", () => {
  it("builds a stable details filter key", () => {
    expect(
      buildDetailsFilterKey({
        categoryId: "cat_1",
        currency: "USD",
        minAmount: "10",
        maxAmount: "50",
      })
    ).toBe("cat:cat_1|cur:USD|min:10|max:50");
  });

  it("returns null filter key when no advanced filters are set", () => {
    expect(buildDetailsFilterKey({})).toBeNull();
  });

  it("derives details query state from period params", () => {
    expect(
      getDetailsInitialQueryState({
        period: "custom",
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      })
    ).toEqual({
      startDateStr: "2026-03-01",
      endDateStr: "2026-03-31",
      filterKey: null,
    });
  });

  it("derives same-period month stats truncated to the current date", () => {
    const state = getStatsInitialQueryState(new Date(2026, 2, 18), DEFAULT_STATS_RANGE_TYPE);

    expect(state.rangeType).toBe("month");
    expect(state.startDateStr).toBe("2026-03-01");
    expect(state.endDateStr).toBe("2026-03-18");
    expect(state.prevDateStartStr).toBe("2026-02-01");
    expect(state.prevDateEndStr).toBe("2026-02-18");
    expect(state.mode).toBe("same_period");
  });

  it("clamps the previous period to the legal period end", () => {
    const state = getStatsInitialQueryState(new Date(2026, 2, 31), DEFAULT_STATS_RANGE_TYPE);

    expect(state.rangeType).toBe("month");
    expect(state.startDateStr).toBe("2026-03-01");
    expect(state.endDateStr).toBe("2026-03-31");
    expect(state.prevDateStartStr).toBe("2026-02-01");
    expect(state.prevDateEndStr).toBe("2026-02-28");
  });

  it("handles leap-year dates when truncating the previous period", () => {
    const state = getStatsInitialQueryState(new Date(2028, 1, 29), DEFAULT_STATS_RANGE_TYPE);

    expect(state.startDateStr).toBe("2028-02-01");
    expect(state.endDateStr).toBe("2028-02-29");
    expect(state.prevDateStartStr).toBe("2028-01-01");
    expect(state.prevDateEndStr).toBe("2028-01-29");
  });

  it("uses full periods for historical stats windows", () => {
    const state = getStatsInitialQueryState(new Date(2026, 2, 18), DEFAULT_STATS_RANGE_TYPE, {
      currentPeriod: false,
    });

    expect(state.mode).toBe("full_period");
    expect(state.startDateStr).toBe("2026-03-01");
    expect(state.endDateStr).toBe("2026-03-31");
    expect(state.prevDateStartStr).toBe("2026-02-01");
    expect(state.prevDateEndStr).toBe("2026-02-28");
  });

  it("truncates week and year ranges to the same elapsed days", () => {
    const week = getStatsInitialQueryState(new Date(2026, 7, 5), "week");
    expect(week.startDateStr).toBe("2026-08-03");
    expect(week.endDateStr).toBe("2026-08-05");
    expect(week.prevDateStartStr).toBe("2026-07-27");
    expect(week.prevDateEndStr).toBe("2026-07-29");

    const year = getStatsInitialQueryState(new Date(2026, 7, 5), "year");
    expect(year.startDateStr).toBe("2026-01-01");
    expect(year.endDateStr).toBe("2026-08-05");
    expect(year.prevDateStartStr).toBe("2025-01-01");
    expect(year.prevDateEndStr).toBe("2025-08-05");
  });
});
