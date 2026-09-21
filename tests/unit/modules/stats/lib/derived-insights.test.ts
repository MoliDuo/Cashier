import { describe, expect, it } from "vitest";
import { deriveStatsInsights } from "@/modules/stats/lib/derived-insights";
import { buildEnhancedStatsFixture } from "tests/helpers/stats-fixture";
import type { EnhancedStatsDto } from "@/modules/stats/contracts";

type Day = { date: string; total: string; entryCount?: number };

function statsWithDays(days: Day[], overrides: Partial<EnhancedStatsDto> = {}) {
  return buildEnhancedStatsFixture({
    chart: days.map((day) => ({ date: day.date, total: day.total })),
    heatmap: {
      days: days.map((day) => ({
        date: day.date,
        totalAmount: day.total,
        entryCount: day.entryCount ?? 1,
        currencies: ["CNY"],
      })),
      stats: { minAmount: "0", maxAmount: "0", avgAmount: "0", p80Amount: "0" },
    },
    ...overrides,
  });
}

function category(overrides: Partial<EnhancedStatsDto["categories"][number]> = {}) {
  return {
    id: "food",
    name: "Food",
    icon: null,
    totalConverted: "100",
    currency: "CNY",
    percent: 100,
    count: 1,
    trend: { percent: 0, amount: "0" },
    ...overrides,
  };
}

// 2026-09-07 is a Monday, so this window runs Monday to Sunday.
const week = { startDate: "2026-09-07", endDate: "2026-09-13" };

describe("deriveStatsInsights", () => {
  it("counts the window's days even when nothing was recorded in it", () => {
    const insights = deriveStatsInsights(buildEnhancedStatsFixture(), week);

    expect(insights).toMatchObject({
      entryCount: 0,
      averageEntry: null,
      activeDays: 0,
      periodDays: 7,
      busiestDay: null,
      longestStreak: 0,
      topMover: null,
    });
    expect(insights.weekdayAverages.map((day) => day.occurrences)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(insights.weekdayAverages.map((day) => day.average)).toEqual(Array(7).fill("0"));
  });

  it("reports no average entry rather than a zero one when nothing was recorded", () => {
    // A zero average reads as "you spent nothing per entry", which is a claim
    // about entries that do not exist.
    expect(deriveStatsInsights(buildEnhancedStatsFixture(), week).averageEntry).toBeNull();
  });

  it("averages an entry over the categories' counts, not over the days", () => {
    const stats = statsWithDays([{ date: "2026-09-07", total: "120" }], {
      summary: { ...buildEnhancedStatsFixture().summary, total: "120" },
      categories: [category({ count: 3 })],
    });

    expect(deriveStatsInsights(stats, week)).toMatchObject({ entryCount: 3, averageEntry: "40" });
  });

  it("counts a day that nets out to zero as recorded", () => {
    // Something bought and returned the same day nets to zero, but the day was
    // still worked on.
    const insights = deriveStatsInsights(
      statsWithDays([{ date: "2026-09-07", total: "0", entryCount: 2 }]),
      week
    );

    expect(insights.activeDays).toBe(1);
    expect(insights.longestStreak).toBe(1);
  });

  it("breaks the streak on a gap instead of walking the recorded days in order", () => {
    // The recorded days are sparse: reading them as a sequence would call the
    // 7th and the 13th two consecutive days.
    const insights = deriveStatsInsights(
      statsWithDays([
        { date: "2026-09-07", total: "10" },
        { date: "2026-09-11", total: "10" },
        { date: "2026-09-12", total: "10" },
        { date: "2026-09-13", total: "10" },
      ]),
      week
    );

    expect(insights.longestStreak).toBe(3);
    expect(insights.activeDays).toBe(4);
  });

  it("divides a weekday by how often it falls in the window, not by its recorded days", () => {
    // Two Mondays, one of them with nothing on it. Averaging over recorded days
    // would report 100 and hide that half the Mondays were quiet.
    const fortnight = { startDate: "2026-09-07", endDate: "2026-09-20" };
    const insights = deriveStatsInsights(
      statsWithDays([{ date: "2026-09-07", total: "100" }]),
      fortnight
    );

    const monday = insights.weekdayAverages[0]!;
    expect(monday).toEqual({ weekday: 0, occurrences: 2, average: "50" });
  });

  it("keeps a biggest day for a period that nets out negative", () => {
    const insights = deriveStatsInsights(
      statsWithDays([
        { date: "2026-09-07", total: "-40" },
        { date: "2026-09-08", total: "-10" },
      ]),
      week
    );

    expect(insights.busiestDay).toEqual({ date: "2026-09-08", total: "-10" });
  });

  it("names the category that moved by the most money, not by the most percent", () => {
    const base = buildEnhancedStatsFixture();
    const stats = buildEnhancedStatsFixture({
      summary: { ...base.summary, total: "1000" },
      categories: [
        category({ id: "rent", name: "Rent", trend: { percent: 10, amount: "300" } }),
        category({ id: "gum", name: "Gum", trend: { percent: 100, amount: "3" } }),
      ],
    });

    expect(deriveStatsInsights(stats, week).topMover).toEqual({
      id: "rent",
      name: "Rent",
      amountDelta: "300",
      direction: "up",
    });
  });

  it("stays quiet when the biggest move is small against the period", () => {
    const base = buildEnhancedStatsFixture();
    const stats = buildEnhancedStatsFixture({
      summary: { ...base.summary, total: "1000" },
      categories: [category({ id: "gum", name: "Gum", trend: { percent: 100, amount: "3" } })],
    });

    expect(deriveStatsInsights(stats, week).topMover).toBeNull();
  });

  it("stays quiet when there is no previous period to compare against", () => {
    // Every category reads as +100% growth from nothing, which says nothing.
    const base = buildEnhancedStatsFixture();
    const stats = buildEnhancedStatsFixture({
      summary: {
        ...base.summary,
        total: "1000",
        comparison: { ...base.summary.comparison, previousTotal: "0" },
      },
      categories: [category({ id: "rent", name: "Rent", trend: { percent: 100, amount: "900" } })],
    });

    expect(deriveStatsInsights(stats, week).topMover).toBeNull();
  });

  it("reads a drop as a drop", () => {
    const base = buildEnhancedStatsFixture();
    const stats = buildEnhancedStatsFixture({
      summary: { ...base.summary, total: "1000" },
      categories: [category({ id: "rent", name: "Rent", trend: { percent: -30, amount: "-300" } })],
    });

    expect(deriveStatsInsights(stats, week).topMover).toMatchObject({
      amountDelta: "300",
      direction: "down",
    });
  });

  it("spans a window that crosses a month boundary", () => {
    const insights = deriveStatsInsights(
      statsWithDays([
        { date: "2026-08-31", total: "10" },
        { date: "2026-09-01", total: "10" },
      ]),
      { startDate: "2026-08-31", endDate: "2026-09-01" }
    );

    expect(insights).toMatchObject({ periodDays: 2, activeDays: 2, longestStreak: 2 });
  });
});
