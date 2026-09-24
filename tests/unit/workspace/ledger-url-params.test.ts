import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildLedgerUrl,
  parseStatusesParam,
  formatStatusesParam,
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

  it("clears startDate and endDate when switching to non-custom period", () => {
    const params = updateLedgerSearchParams(
      new URLSearchParams(
        "streamPeriod=custom&streamStartDate=2024-01-01&streamEndDate=2024-01-31"
      ),
      { period: "week" },
      "stream"
    );

    expect(params.get("streamPeriod")).toBe("week");
    expect(params.get("streamStartDate")).toBeNull();
    expect(params.get("streamEndDate")).toBeNull();
  });

  it("treats __uncategorized__ as a real category filter while clearing empty params", () => {
    const params = updateLedgerSearchParams(
      new URLSearchParams(
        "streamCategoryId=old&streamCurrency=USD&streamMinAmount=5&streamMaxAmount=10"
      ),
      {
        categoryId: "__uncategorized__",
        currency: "",
        minAmount: null,
        maxAmount: "NaN",
      },
      "stream"
    );

    expect(params.get("streamCategoryId")).toBe("__uncategorized__");
    expect(params.get("streamCurrency")).toBeNull();
    expect(params.get("streamMinAmount")).toBeNull();
    expect(params.get("streamMaxAmount")).toBeNull();
  });

  it("reads __uncategorized__ back from the URL", () => {
    const filters = readLedgerFilterParams(
      new URLSearchParams("streamCategoryId=__uncategorized__&streamCurrency=USD"),
      "stream"
    );

    expect(filters.categoryId).toBe("__uncategorized__");
    expect(filters.statuses).toEqual([]);
  });

  it("doesn't drop uncategorized when unrelated params change", () => {
    const params = updateLedgerSearchParams(
      new URLSearchParams("streamCategoryId=__uncategorized__"),
      {
        currency: "EUR",
      },
      "stream"
    );

    expect(params.toString()).toContain("streamCategoryId=__uncategorized__");
  });

  it("reads normalized filter params from URLSearchParams", () => {
    const filters = readLedgerFilterParams(
      new URLSearchParams(
        "streamCategoryId=cat_2&streamCurrency=EUR&streamMinAmount=100&streamMaxAmount=250"
      ),
      "stream"
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
    const params = updateLedgerSearchParams(
      new URLSearchParams("streamMinAmount=5"),
      {
        minAmount: "100",
        maxAmount: "250",
      },
      "stream"
    );

    expect(params.get("streamMinAmount")).toBe("100");
    expect(params.get("streamMaxAmount")).toBe("250");
  });

  it("rejects non-finite and blank numeric filter params", () => {
    for (const raw of ["", " ", "Infinity", "-Infinity", "NaN"]) {
      const filters = readLedgerFilterParams(
        new URLSearchParams(`streamMinAmount=${encodeURIComponent(raw)}`),
        "stream"
      );
      expect(filters.minAmount).toBeNull();
    }

    const params = updateLedgerSearchParams(
      new URLSearchParams("streamMinAmount=1&streamMaxAmount=2"),
      {
        minAmount: "Infinity",
        maxAmount: "-Infinity",
      },
      "stream"
    );
    expect(params.get("streamMinAmount")).toBeNull();
    expect(params.get("streamMaxAmount")).toBeNull();
  });

  it("builds URLs without introducing navigation side effects", () => {
    const params = new URLSearchParams("tab=details&streamPeriod=custom");

    expect(buildLedgerUrl("/ledger/test-id", params)).toBe(
      "/ledger/test-id?tab=details&streamPeriod=custom"
    );
  });

  it("replaces the browser URL synchronously", () => {
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    const params = new URLSearchParams("tab=details&streamPeriod=custom");

    const replacedUrl = replaceLedgerUrl("/ledger/test-id", params);

    expect(replacedUrl).toBe("/ledger/test-id?tab=details&streamPeriod=custom");
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
      const params = updateLedgerSearchParams(
        new URLSearchParams(""),
        {
          statuses: ["failed", "failed"],
        },
        "stream"
      );

      expect(params.get("streamStatuses")).toBe("failed");
    });

    it("deletes statuses parameter when the filter is cleared", () => {
      for (const statuses of [null, []] as const) {
        const params = updateLedgerSearchParams(
          new URLSearchParams("streamStatuses=processing,failed"),
          {
            statuses: statuses == null ? null : [...statuses],
          },
          "stream"
        );
        expect(params.get("streamStatuses")).toBeNull();
      }
    });

    it("preserves existing statuses when not in updates", () => {
      const params = updateLedgerSearchParams(
        new URLSearchParams("streamStatuses=processing,failed"),
        {
          period: "all",
        },
        "stream"
      );

      expect(params.get("streamStatuses")).toBe("processing,failed");
    });

    it("sets statuses together with other params in one update", () => {
      const params = updateLedgerSearchParams(
        new URLSearchParams("streamPeriod=thisMonth&streamMinAmount=10"),
        {
          period: "all",
          minAmount: null,
          maxAmount: null,
          statuses: ["cancelled", "failed", "failed"],
        },
        "stream"
      );

      expect(params.get("streamPeriod")).toBe("all");
      expect(params.get("streamStartDate")).toBeNull();
      expect(params.get("streamEndDate")).toBeNull();
      expect(params.get("streamMinAmount")).toBeNull();
      expect(params.get("streamMaxAmount")).toBeNull();
      expect(params.get("streamStatuses")).toBe("failed,cancelled");
    });
  });

  describe("statuses in readLedgerFilterParams", () => {
    it("reads statuses from URL", () => {
      const filters = readLedgerFilterParams(
        new URLSearchParams("streamStatuses=processing,failed"),
        "stream"
      );

      expect(filters.statuses).toEqual(["processing", "failed"]);
    });

    it("returns empty array when statuses param is absent", () => {
      const filters = readLedgerFilterParams(
        new URLSearchParams("streamCategoryId=cat_1"),
        "stream"
      );

      expect(filters.statuses).toEqual([]);
    });
  });

  describe("book scope", () => {
    it("ignores the legacy ?bookId URL parameter entirely", () => {
      // The scope moved to a device cookie; a link that still carries the old
      // parameter is read as 总账 and the parameter is not even cleaned up.
      expect(
        readLedgerFilterParams(new URLSearchParams("bookId=nonsense"), "stream")
      ).toBeDefined();
      expect(
        normalizeLedgerUrlSearchParams(new URLSearchParams(`bookId=${"1".repeat(36)}`))
      ).toBeNull();
    });
  });
});

it("ignores unscoped bookmarks instead of migrating them", () => {
  const params = new URLSearchParams("categoryId=old&statuses=failed&search=coffee");
  expect(readLedgerFilterParams(params, "stream")).toMatchObject({
    categoryId: null,
    statuses: [],
    search: null,
  });
  expect(readLedgerFilterParams(params, "details")).toMatchObject({
    categoryId: null,
    statuses: [],
    search: null,
  });
});
