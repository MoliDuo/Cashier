import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  buildEnhancedStatsDto,
  type EnhancedStatsBucket,
} from "@/modules/stats/domain/build-enhanced-stats";

function bucket(
  days: Record<string, { total: string; count?: number }> = {},
  categories: Record<string, { name: string; total: string; count?: number }> = {}
): EnhancedStatsBucket {
  const total = Object.values(days).reduce(
    (sum, day) => sum.plus(day.total),
    Object.keys(days).length === 0
      ? Object.values(categories).reduce(
          (sum, category) => sum.plus(category.total),
          new Decimal(0)
        )
      : new Decimal(0)
  );
  return {
    total,
    categories: new Map(
      Object.entries(categories).map(([id, category]) => [
        id,
        {
          id,
          name: category.name,
          icon: null,
          total: new Decimal(category.total),
          count: category.count ?? 1,
        },
      ])
    ),
    days: new Map(
      Object.entries(days).map(([date, day]) => [
        date,
        { total: new Decimal(day.total), count: day.count ?? 1, currencies: new Set(["CNY"]) },
      ])
    ),
  };
}

function build(overrides: Partial<Parameters<typeof buildEnhancedStatsDto>[0]> = {}) {
  return buildEnhancedStatsDto({
    mainCurrency: "CNY",
    unconvertedCount: 0,
    current: bucket(),
    previous: bucket(),
    queryRange: { from: "2026-09-01", to: "2026-09-03" },
    compareRange: { from: "2026-08-01", to: "2026-08-03" },
    ...overrides,
  });
}

describe("buildEnhancedStatsDto", () => {
  it("reports the comparison window's daily totals, not only its sum", () => {
    // The comparison bucket has always carried per-day figures; a reader that
    // wants to draw last period alongside this one needs them, and reducing
    // them to a single previousTotal on the way out threw that away.
    const result = build({
      current: bucket({ "2026-09-01": { total: "10" }, "2026-09-03": { total: "30" } }),
      previous: bucket({ "2026-08-02": { total: "7" }, "2026-08-01": { total: "5" } }),
    });

    expect(result.previousChart).toEqual([
      { date: "2026-08-01", total: "5" },
      { date: "2026-08-02", total: "7" },
    ]);
    expect(result.chart).toEqual([
      { date: "2026-09-01", total: "10" },
      { date: "2026-09-03", total: "30" },
    ]);
  });

  it("leaves the comparison series empty when the previous window has no days", () => {
    expect(build({ current: bucket({ "2026-09-01": { total: "10" } }) }).previousChart).toEqual([]);
  });

  it("measures a category's share against what was spent, not against the net", () => {
    // A refund nets against the period total. Measured against that shrunken
    // denominator, the spending categories add up to well over 100%.
    const result = build({
      current: bucket(
        { "2026-09-01": { total: "60" } },
        {
          food: { name: "Food", total: "100" },
          travel: { name: "Travel", total: "50" },
          refund: { name: "Refund", total: "-90" },
        }
      ),
    });

    const shares = Object.fromEntries(result.categories.map((c) => [c.name, c.percent]));
    expect(shares).toEqual({ Food: 100 / 1.5, Travel: 50 / 1.5, Refund: 0 });
    expect(shares.Food! + shares.Travel!).toBeCloseTo(100, 10);
  });

  it("gives every category a zero share when nothing was spent", () => {
    const result = build({
      current: bucket(
        { "2026-09-01": { total: "-5" } },
        { refund: { name: "Refund", total: "-5" } }
      ),
    });

    expect(result.categories.map((category) => category.percent)).toEqual([0]);
  });
});
