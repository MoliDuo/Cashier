import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/query-keys";
import {
  buildDetailsQueryDescriptor,
  buildStatsQueryDescriptor,
  buildStreamQueryDescriptor,
} from "@/modules/workspace/ledger-tab-query-descriptors";

describe("ledger tab query descriptors", () => {
  it("keeps stream search filters identical in the page input, total input, and keys", () => {
    const descriptor = buildStreamQueryDescriptor({
      ledgerId: "ledger-1",
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      search: "  coffee  ",
    });

    expect(descriptor.getPageInput()).toEqual({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      search: "coffee",
      limit: 20,
    });
    expect(descriptor.totalInput).toEqual({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      search: "coffee",
    });
    expect(descriptor.queryKey).toEqual(
      queryKeys.sourceDocumentStream("ledger-1", {
        bookId: null,
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        minAmount: null,
        maxAmount: null,
        statuses: null,
        search: "coffee",
      })
    );
    expect(descriptor.totalQueryKey).toEqual(
      queryKeys.sourceDocumentStreamTotal("ledger-1", {
        bookId: null,
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        minAmount: null,
        maxAmount: null,
        statuses: null,
        search: "coffee",
      })
    );
  });

  it("keeps details search filters in both summary and entries requests", () => {
    const descriptor = buildDetailsQueryDescriptor({
      ledgerId: "ledger-1",
      periodParams: {
        period: "custom",
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      },
      advancedFilters: { search: "  coffee " },
      mainCurrency: "USD",
    });

    expect(descriptor.summaryParams.filters).toEqual({ search: "coffee" });
    expect(descriptor.getEntriesInput()).toEqual({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      search: "coffee",
      limit: 50,
    });
    expect(descriptor.summaryQueryKey).toEqual(
      queryKeys.summary("ledger-1", {
        bookId: null,
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        currency: "USD",
        filter: "search:coffee",
      })
    );
    expect(descriptor.entriesQueryKey).toEqual(
      queryKeys.ledgerEntries("ledger-1", {
        bookId: null,
        mode: "infinite",
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        filter: "search:coffee",
      })
    );
  });

  it("scopes details requests and cache keys to the selected member", () => {
    const input = {
      ledgerId: "ledger-1",
      periodParams: { period: "custom" as const, startDate: "2026-03-01", endDate: "2026-03-31" },
      mainCurrency: "USD",
    };
    const mine = buildDetailsQueryDescriptor({ ...input, bookId: "member-1" });
    const partner = buildDetailsQueryDescriptor({ ...input, bookId: "member-2" });
    expect(mine.getEntriesInput()).toEqual(expect.objectContaining({ bookId: "member-1" }));
    expect(mine.summaryParams.filters.bookId).toBe("member-1");
    expect(mine.entriesQueryKey).not.toEqual(partner.entriesQueryKey);
    expect(mine.summaryQueryKey).not.toEqual(partner.summaryQueryKey);
  });

  it("uses the same stats date ranges for the key and the request input", () => {
    const descriptor = buildStatsQueryDescriptor({
      ledgerId: "ledger-1",
      currentDate: new Date(2026, 2, 20),
      mainCurrency: "USD",
    });

    expect(descriptor.queryKey).toEqual(
      queryKeys.enhancedStats("ledger-1", {
        bookId: null,
        startDate: descriptor.state.startDateStr,
        endDate: descriptor.state.endDateStr,
        compareStartDate: descriptor.state.prevDateStartStr,
        compareEndDate: descriptor.state.prevDateEndStr,
        rangeType: descriptor.state.rangeType,
        comparisonMode: descriptor.state.mode,
        mainCurrency: "USD",
      })
    );
    expect(descriptor.input).toEqual({
      ledgerId: "ledger-1",
      queryRange: {
        from: descriptor.state.startDateStr,
        to: descriptor.state.endDateStr,
      },
      compareRange: {
        from: descriptor.state.prevDateStartStr,
        to: descriptor.state.prevDateEndStr,
      },
      comparisonMode: descriptor.state.mode,
    });
  });
});
