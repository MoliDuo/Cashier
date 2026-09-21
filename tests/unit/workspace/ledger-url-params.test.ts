import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildLedgerUrl,
  parseStatusesParam,
  formatStatusesParam,
  migrateLegacyLedgerSearchParams,
  normalizeLedgerUrlSearchParams,
  readLedgerFilterParams,
  readStatsSearchParams,
  setStatsSearchParams,
  updateLedgerSearchParams,
} from "@/modules/workspace/ledger-url-params";
import { pushLedgerUrl, replaceLedgerUrl } from "@/modules/workspace/ledger-url-navigation";

describe("ledger-url-params", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves unrelated params while updating tab only", () => {
    const params = updateLedgerSearchParams(new URLSearchParams("period=month&categoryId=cat_1"), {
      tab: "details",
    });

    expect(params.toString()).toContain("tab=details");
    expect(params.toString()).toContain("period=month");
    expect(params.toString()).toContain("categoryId=cat_1");
  });

  it("clears startDate and endDate when switching to non-custom period", () => {
    const params = updateLedgerSearchParams(
      new URLSearchParams("period=custom&startDate=2024-01-01&endDate=2024-01-31"),
      { period: "week" }
    );

    expect(params.get("period")).toBe("week");
    expect(params.get("startDate")).toBeNull();
    expect(params.get("endDate")).toBeNull();
  });

  it("treats __uncategorized__ as a real category filter while clearing empty params", () => {
    const params = updateLedgerSearchParams(
      new URLSearchParams("categoryId=old&currency=USD&minAmount=5&maxAmount=10"),
      {
        categoryId: "__uncategorized__",
        currency: "",
        minAmount: null,
        maxAmount: "NaN",
      }
    );

    expect(params.get("categoryId")).toBe("__uncategorized__");
    expect(params.get("currency")).toBeNull();
    expect(params.get("minAmount")).toBeNull();
    expect(params.get("maxAmount")).toBeNull();
  });

  it("reads __uncategorized__ back from the URL", () => {
    const filters = readLedgerFilterParams(
      new URLSearchParams("categoryId=__uncategorized__&currency=USD")
    );

    expect(filters.categoryId).toBe("__uncategorized__");
    expect(filters.statuses).toEqual([]);
  });

  it("doesn't drop uncategorized when unrelated params change", () => {
    const params = updateLedgerSearchParams(new URLSearchParams("categoryId=__uncategorized__"), {
      currency: "EUR",
    });

    expect(params.toString()).toContain("categoryId=__uncategorized__");
  });

  it("reads normalized filter params from URLSearchParams", () => {
    const filters = readLedgerFilterParams(
      new URLSearchParams("categoryId=cat_2&currency=EUR&minAmount=100&maxAmount=250")
    );

    expect(filters).toEqual({
      categoryId: "cat_2",
      currency: "EUR",
      minAmount: "100",
      maxAmount: "250",
      statuses: [],
      search: null,
    });
  });

  it("writes and overwrites numeric filter params", () => {
    const params = updateLedgerSearchParams(new URLSearchParams("minAmount=5"), {
      minAmount: "100",
      maxAmount: "250",
    });

    expect(params.get("minAmount")).toBe("100");
    expect(params.get("maxAmount")).toBe("250");
  });

  it("rejects non-finite and blank numeric filter params", () => {
    for (const raw of ["", " ", "Infinity", "-Infinity", "NaN"]) {
      const filters = readLedgerFilterParams(
        new URLSearchParams(`minAmount=${encodeURIComponent(raw)}`)
      );
      expect(filters.minAmount).toBeNull();
    }

    const params = updateLedgerSearchParams(new URLSearchParams("minAmount=1&maxAmount=2"), {
      minAmount: "Infinity",
      maxAmount: "-Infinity",
    });
    expect(params.get("minAmount")).toBeNull();
    expect(params.get("maxAmount")).toBeNull();
  });

  it("preserves legacy search params until a scoped update migrates them", () => {
    const params = updateLedgerSearchParams(
      new URLSearchParams("search=coffee&period=thisMonth&foo=bar"),
      { tab: "details" }
    );

    expect(params.get("search")).toBe("coffee");
    expect(params.get("period")).toBe("thisMonth");
    expect(params.get("foo")).toBe("bar");
    expect(params.get("tab")).toBe("details");
  });

  it("builds URLs without introducing navigation side effects", () => {
    const params = new URLSearchParams("tab=details&period=custom");

    expect(buildLedgerUrl("/ledger/test-id", params)).toBe(
      "/ledger/test-id?tab=details&period=custom"
    );
  });

  it("replaces the browser URL synchronously", () => {
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    const params = new URLSearchParams("tab=details&period=custom");

    const replacedUrl = replaceLedgerUrl("/ledger/test-id", params);

    expect(replacedUrl).toBe("/ledger/test-id?tab=details&period=custom");
    expect(replaceState).toHaveBeenCalled();
  });

  it("replaces a detail entry when navigating so Back cannot restore the modal", () => {
    window.history.replaceState(
      { cashier: { ledgerNavigation: true, kind: "detail" } },
      "",
      "/ledger/test-id?detailType=source-document&detailId=document-1"
    );
    const replaceState = vi.spyOn(window.history, "replaceState");
    const pushState = vi.spyOn(window.history, "pushState");

    const url = pushLedgerUrl(
      "/ledger/test-id",
      new URLSearchParams("tab=stats&detailType=source-document&detailId=document-1"),
      "tab"
    );

    expect(url).toBe("/ledger/test-id?tab=stats");
    expect(replaceState).toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });

  it("drops a stale ledger-entry detail link now that entries have no sheet", () => {
    const normalized = normalizeLedgerUrlSearchParams(
      new URLSearchParams("tab=details&detailType=ledger-entry&detailId=entry-1")
    );

    expect(normalized?.toString()).toBe("tab=details");
  });

  it.each([
    ["week", -999, -521],
    ["month", -999, -119],
    ["year", -999, -9],
  ] as const)("clamps %s stats offsets to the supported history", (range, offset, expected) => {
    expect(
      readStatsSearchParams(new URLSearchParams(`statsRange=${range}&statsOffset=${offset}`)).offset
    ).toBe(expected);
  });

  it.each(["1", "1.5", "Infinity", "-Infinity", "NaN"])(
    "normalizes invalid stats offset %s to zero",
    (offset) => {
      expect(readStatsSearchParams(new URLSearchParams(`statsOffset=${offset}`)).offset).toBe(0);
    }
  );

  it("clamps stats offsets when serializing URL state", () => {
    const params = setStatsSearchParams(new URLSearchParams(), {
      range: "year",
      offset: -100,
      view: "trend",
    });
    expect(params.get("statsOffset")).toBe("-9");
  });

  it("keeps Stream and Details filter namespaces isolated", () => {
    const initial = new URLSearchParams(
      "streamPeriod=week&streamCategoryId=stream-cat&detailsPeriod=year&detailsCategoryId=details-cat"
    );

    const next = updateLedgerSearchParams(initial, { currency: "EUR" }, "details");

    expect(next.get("streamPeriod")).toBe("week");
    expect(next.get("streamCategoryId")).toBe("stream-cat");
    expect(next.get("detailsPeriod")).toBe("year");
    expect(next.get("detailsCategoryId")).toBe("details-cat");
    expect(next.get("detailsCurrency")).toBe("EUR");
    expect(readLedgerFilterParams(next, "stream").currency).toBeNull();
    expect(readLedgerFilterParams(next, "details").currency).toBe("EUR");
  });

  it("stores independent streamSearch and detailsSearch parameters", () => {
    const stream = updateLedgerSearchParams(
      new URLSearchParams("detailsSearch=latte"),
      { search: "receipt" },
      "stream"
    );
    const details = updateLedgerSearchParams(stream, { search: "morning" }, "details");

    expect(details.get("streamSearch")).toBe("receipt");
    expect(details.get("detailsSearch")).toBe("morning");
    expect(readLedgerFilterParams(details, "stream").search).toBe("receipt");
    expect(readLedgerFilterParams(details, "details").search).toBe("morning");
  });

  it("does not read legacy filters until they are explicitly migrated", () => {
    const legacy = new URLSearchParams(
      "period=custom&startDate=2026-07-01&endDate=2026-07-31&categoryId=cat-1&statuses=failed"
    );

    expect(readLedgerFilterParams(legacy, "stream").categoryId).toBeNull();
    const migratedLegacy = migrateLegacyLedgerSearchParams(legacy, "stream");
    expect(migratedLegacy).not.toBeNull();
    const migrated = updateLedgerSearchParams(
      migratedLegacy ?? legacy,
      { currency: "CNY" },
      "stream"
    );

    expect(migrated.get("period")).toBeNull();
    expect(migrated.get("categoryId")).toBeNull();
    expect(migrated.get("streamPeriod")).toBe("custom");
    expect(migrated.get("streamStartDate")).toBe("2026-07-01");
    expect(migrated.get("streamEndDate")).toBe("2026-07-31");
    expect(migrated.get("streamCategoryId")).toBe("cat-1");
    expect(migrated.get("streamStatuses")).toBe("failed");
  });

  describe("parseStatusesParam", () => {
    it("normalizes status filters into canonical valid values", () => {
      const cases = [
        [null, []],
        ["", []],
        ["completed", ["completed"]],
        ["failed,processing", ["processing", "failed"]],
        ["processing,processing,processing", ["processing"]],
        ["processing,unknown_status,failed", ["processing", "failed"]],
        ["unknown,bogus", []],
        [" processing , failed ", ["processing", "failed"]],
        [",processing,", ["processing"]],
        ["processing,,failed", ["processing", "failed"]],
      ] as const;

      for (const [input, expected] of cases) {
        expect(parseStatusesParam(input)).toEqual(expected);
      }
    });
  });

  describe("formatStatusesParam", () => {
    it("serializes status filters canonically", () => {
      const cases = [
        [[], null],
        [["completed"], "completed"],
        [["failed", "processing"], "processing,failed"],
        [["processing", "processing", "processing"], "processing"],
      ] as const;

      for (const [input, expected] of cases) {
        expect(formatStatusesParam([...input])).toBe(expected);
      }
    });
  });

  describe("statuses in updateLedgerSearchParams", () => {
    it("sets statuses parameter when provided", () => {
      const params = updateLedgerSearchParams(new URLSearchParams(""), {
        statuses: ["failed", "failed"],
      });

      expect(params.get("statuses")).toBe("failed");
    });

    it("deletes statuses parameter when the filter is cleared", () => {
      for (const statuses of [null, []] as const) {
        const params = updateLedgerSearchParams(new URLSearchParams("statuses=processing,failed"), {
          statuses: statuses == null ? null : [...statuses],
        });
        expect(params.get("statuses")).toBeNull();
      }
    });

    it("preserves existing statuses when not in updates", () => {
      const params = updateLedgerSearchParams(new URLSearchParams("statuses=processing,failed"), {
        period: "all",
      });

      expect(params.get("statuses")).toBe("processing,failed");
    });

    it("sets statuses together with other params in one update", () => {
      const params = updateLedgerSearchParams(
        new URLSearchParams("period=thisMonth&minAmount=10"),
        {
          period: "all",
          minAmount: null,
          maxAmount: null,
          statuses: ["cancelled", "failed", "failed"],
          tab: "stream",
        }
      );

      expect(params.get("period")).toBe("all");
      expect(params.get("startDate")).toBeNull();
      expect(params.get("endDate")).toBeNull();
      expect(params.get("minAmount")).toBeNull();
      expect(params.get("maxAmount")).toBeNull();
      expect(params.get("statuses")).toBe("failed,cancelled");
      expect(params.get("tab")).toBe("stream");
    });
  });

  describe("statuses in readLedgerFilterParams", () => {
    it("reads statuses from URL", () => {
      const filters = readLedgerFilterParams(new URLSearchParams("statuses=processing,failed"));

      expect(filters.statuses).toEqual(["processing", "failed"]);
    });

    it("returns empty array when statuses param is absent", () => {
      const filters = readLedgerFilterParams(new URLSearchParams("categoryId=cat_1"));

      expect(filters.statuses).toEqual([]);
    });
  });

  describe("book scope", () => {
    it("ignores the legacy ?bookId URL parameter entirely", () => {
      // The scope moved to a device cookie; a link that still carries the old
      // parameter is read as 总账 and the parameter is not even cleaned up.
      expect(readLedgerFilterParams(new URLSearchParams("bookId=nonsense"))).toBeDefined();
      expect(
        normalizeLedgerUrlSearchParams(new URLSearchParams(`bookId=${"1".repeat(36)}`))
      ).toBeNull();
    });
  });
});
