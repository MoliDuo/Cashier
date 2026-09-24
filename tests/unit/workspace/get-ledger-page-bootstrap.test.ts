import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultLedger } from "tests/helpers/default-ledger";
import { getLedgerPageBootstrap as getLedgerPageBootstrapUseCase } from "@/modules/workspace/application/queries/get-ledger-page-bootstrap";
import { buildStatsQueryDescriptor } from "@/modules/workspace/ledger-tab-query-descriptors";
import type { CategoryPort } from "@/application/contracts";
import type { LedgerReadPort } from "@/modules/ledger/application/ports";
import type { StatsReadPort } from "@/modules/stats/application/ports";
import type {
  SourceDocumentReadPort,
  LedgerChangeReadPort,
} from "@/modules/source-document/application/ports";
import type { BookPort, ServiceCredentialPort } from "@/application/contracts";

const listBooksMock = vi.fn();

const bootstrapDependencies = {
  categories: {
    listWithCount: vi.fn(),
    countUncategorized: vi.fn(),
  } satisfies Pick<CategoryPort, "listWithCount" | "countUncategorized">,
  books: { list: listBooksMock } satisfies Pick<BookPort, "list">,
  ledgerReads: {
    calculateStats: vi.fn(),
    listEntries: vi.fn(),
    listEntriesBySourceDocumentIds: vi.fn(),
  } satisfies Pick<
    LedgerReadPort,
    "calculateStats" | "listEntries" | "listEntriesBySourceDocumentIds"
  >,
  stats: { queryEnhanced: vi.fn() } satisfies Pick<StatsReadPort, "queryEnhanced">,
  sourceDocuments: {
    documents: {
      list: vi.fn(),
      calculateCompletedTotal: vi.fn(),
    },
    ledgerReads: { listEntriesBySourceDocumentIds: vi.fn() },
    changes: { getVersion: vi.fn(), getRefreshBaseline: vi.fn() },
  } satisfies {
    documents: Pick<SourceDocumentReadPort, "list" | "calculateCompletedTotal">;
    ledgerReads: Pick<LedgerReadPort, "listEntriesBySourceDocumentIds">;
    changes: Pick<LedgerChangeReadPort, "getVersion" | "getRefreshBaseline">;
  },
  credentials: { list: vi.fn() } satisfies Pick<ServiceCredentialPort, "list">,
};
/**
 * The zone a repeat visit arrives with: the browser has already written its
 * cookie, so every date read below has an answer to date by. The first visit —
 * a request that names neither a book zone nor a device zone — has its own
 * cases, which pass `deviceTimeZone: null` to take the zone away again.
 */
const REPORTED_DEVICE_TIME_ZONE = "Asia/Shanghai";

const getLedgerPageBootstrap = (
  input: Omit<Parameters<typeof getLedgerPageBootstrapUseCase>[0], "ledgerDto"> &
    Partial<Pick<Parameters<typeof getLedgerPageBootstrapUseCase>[0], "ledgerDto">>
) =>
  getLedgerPageBootstrapUseCase(
    {
      deviceTimeZone: REPORTED_DEVICE_TIME_ZONE,
      ...input,
      ledgerDto: input.ledgerDto ?? createPreAuthorizedLedgerDto(),
    },
    bootstrapDependencies
  );

const listEntryCategoriesMock = vi.hoisted(() => vi.fn());
const calculateLedgerStatsMock = vi.hoisted(() => vi.fn());
const listLedgerEntriesMock = vi.hoisted(() => vi.fn());
const getSourceDocumentCountsQueryMock = vi.hoisted(() => vi.fn());
const listStreamPageMock = vi.hoisted(() => vi.fn());
const getStreamTotalMock = vi.hoisted(() => vi.fn());
const getEnhancedStatsMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/ledger/application/queries/list-entry-categories", () => ({
  listEntryCategories: listEntryCategoriesMock,
}));
vi.mock("@/modules/ledger/application/queries/calculate-ledger-stats", () => ({
  calculateLedgerStats: calculateLedgerStatsMock,
}));
vi.mock("@/modules/ledger/application/queries/list-ledger-entries", () => ({
  listLedgerEntries: listLedgerEntriesMock,
}));

vi.mock("@/modules/source-document/application/queries/list-stream-page", () => ({
  listStreamPage: listStreamPageMock,
}));
vi.mock("@/modules/source-document/application/queries/get-stream-total", () => ({
  getStreamTotal: getStreamTotalMock,
}));

vi.mock("@/modules/stats/application/queries/get-enhanced-stats", () => ({
  getEnhancedStats: getEnhancedStatsMock,
}));
function createPreAuthorizedLedgerDto() {
  return {
    id: "ledger-1",
    userId: "user-1",
    settings: { ...getDefaultLedger().settings, mainCurrency: "USD" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("getLedgerPageBootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    listEntryCategoriesMock.mockResolvedValue([]);
    listBooksMock.mockResolvedValue([
      {
        id: "book-1",
        name: "共同支出",
        timeZone: null,
        sortOrder: 1,
      },
    ]);
    calculateLedgerStatsMock.mockResolvedValue({});
    listLedgerEntriesMock.mockResolvedValue({ items: [], nextCursor: null });
    getSourceDocumentCountsQueryMock.mockResolvedValue({ processingCount: 0, attentionCount: 0 });
    listStreamPageMock.mockResolvedValue({ items: [], nextCursor: null, generation: "1" });
    getStreamTotalMock.mockResolvedValue({ total: "0" });
    getEnhancedStatsMock.mockResolvedValue({});
  });

  it("starts the categories read without waiting for the books", async () => {
    let releaseBooks!: (books: unknown[]) => void;
    listBooksMock.mockReturnValue(
      new Promise((resolve) => {
        releaseBooks = resolve;
      })
    );

    const pending = getLedgerPageBootstrap({
      initialTab: "stream",
      periodParams: { period: "thisMonth" },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(listEntryCategoriesMock).toHaveBeenCalledTimes(1);
    // The reads that need the viewed book's zone still wait for the book.
    expect(listStreamPageMock).not.toHaveBeenCalled();

    releaseBooks([
      {
        id: "book-1",
        name: "共同支出",
        timeZone: null,
        sortOrder: 1,
      },
    ]);
    await expect(pending).resolves.not.toBeNull();
    expect(listStreamPageMock).toHaveBeenCalledTimes(1);
  });

  it("accepts a pre-authorized ledger DTO and skips re-authorization", async () => {
    const preAuthDto = createPreAuthorizedLedgerDto();
    const result = await getLedgerPageBootstrap({
      initialTab: "stream",
      periodParams: { period: "thisMonth" },
      ledgerDto: preAuthDto,
    });

    expect(result).not.toBeNull();
    // The DTO should be seeded into the dehydrated state
    const ledgersQuery = result?.dehydratedState.queries.find((q) => q.queryKey[0] === "ledger");
    expect(ledgersQuery).toBeDefined();
    expect(ledgersQuery?.state.data).toEqual(preAuthDto);
  });

  it("prefetches the first stream page without legacy header counts", async () => {
    const result = await getLedgerPageBootstrap({
      initialTab: "stream",
      periodParams: {
        period: "custom",
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      },
      // Use pre-authorized DTO to test the path without re-authorization
      ledgerDto: createPreAuthorizedLedgerDto(),
    });

    expect(result).not.toBeNull();
    expect(getSourceDocumentCountsQueryMock).not.toHaveBeenCalled();
    expect(listStreamPageMock).toHaveBeenCalled();
    expect(getStreamTotalMock).toHaveBeenCalledWith(
      "ledger-1",
      { startDate: "2026-03-01", endDate: "2026-03-31" },
      bootstrapDependencies.sourceDocuments.documents
    );
    expect(calculateLedgerStatsMock).not.toHaveBeenCalled();
    expect(listLedgerEntriesMock).not.toHaveBeenCalled();
    expect(getEnhancedStatsMock).not.toHaveBeenCalled();
  });

  it("passes min/max amount filters into stream page prefetch", async () => {
    await getLedgerPageBootstrap({
      initialTab: "stream",
      periodParams: {
        period: "custom",
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      },
      advancedFilters: {
        minAmount: "20",
        maxAmount: "100",
      },
      ledgerDto: createPreAuthorizedLedgerDto(),
    });

    expect(listStreamPageMock).toHaveBeenCalledWith(
      "ledger-1",
      {
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        minAmount: "20",
        maxAmount: "100",
        cursor: undefined,
        limit: 20,
      },
      bootstrapDependencies.sourceDocuments
    );
    expect(getStreamTotalMock).toHaveBeenCalledWith(
      "ledger-1",
      { startDate: "2026-03-01", endDate: "2026-03-31", minAmount: "20", maxAmount: "100" },
      bootstrapDependencies.sourceDocuments.documents
    );
  });

  it("passes status filters into stream page prefetch", async () => {
    await getLedgerPageBootstrap({
      initialTab: "stream",
      periodParams: {
        period: "custom",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      },
      advancedFilters: {
        statuses: ["processing", "failed"],
      },
      ledgerDto: createPreAuthorizedLedgerDto(),
    });

    expect(listStreamPageMock).toHaveBeenCalledWith(
      "ledger-1",
      {
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        statuses: ["failed", "processing"],
        cursor: undefined,
        limit: 20,
      },
      bootstrapDependencies.sourceDocuments
    );
    expect(getStreamTotalMock).toHaveBeenCalledWith(
      "ledger-1",
      { startDate: "2026-07-01", endDate: "2026-07-31", statuses: ["failed", "processing"] },
      bootstrapDependencies.sourceDocuments.documents
    );
  });

  it("passes search filters into both stream page and total prefetch", async () => {
    await getLedgerPageBootstrap({
      initialTab: "stream",
      periodParams: {
        period: "custom",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      },
      advancedFilters: {
        search: "  coffee ",
      },
      ledgerDto: createPreAuthorizedLedgerDto(),
    });

    expect(listStreamPageMock).toHaveBeenCalledWith(
      "ledger-1",
      {
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        search: "coffee",
        cursor: undefined,
        limit: 20,
      },
      bootstrapDependencies.sourceDocuments
    );
    expect(getStreamTotalMock).toHaveBeenCalledWith(
      "ledger-1",
      { startDate: "2026-07-01", endDate: "2026-07-31", search: "coffee" },
      bootstrapDependencies.sourceDocuments.documents
    );
  });

  it("prefetches details tab summary and paged entries", async () => {
    await getLedgerPageBootstrap({
      initialTab: "details",
      periodParams: { period: "thisMonth" },
      ledgerDto: createPreAuthorizedLedgerDto(),
    });

    expect(calculateLedgerStatsMock).toHaveBeenCalledOnce();
    expect(listLedgerEntriesMock).toHaveBeenCalledOnce();
    expect(getSourceDocumentCountsQueryMock).not.toHaveBeenCalled();
    expect(getEnhancedStatsMock).not.toHaveBeenCalled();
  });

  it("passes advanced filters into details tab summary and entries prefetch", async () => {
    await getLedgerPageBootstrap({
      initialTab: "details",
      periodParams: {
        period: "custom",
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      },
      advancedFilters: {
        categoryId: "cat-1",
        currency: "USD",
        minAmount: "20",
        maxAmount: "100",
      },
      ledgerDto: createPreAuthorizedLedgerDto(),
    });

    expect(calculateLedgerStatsMock).toHaveBeenCalledWith(
      "ledger-1",
      {
        categoryId: "cat-1",
        currency: "USD",
        minAmount: "20",
        maxAmount: "100",
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      },
      bootstrapDependencies.ledgerReads
    );
    expect(listLedgerEntriesMock).toHaveBeenCalledWith(
      "ledger-1",
      {
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        categoryId: "cat-1",
        currency: "USD",
        minAmount: "20",
        maxAmount: "100",
        cursor: undefined,
        limit: 50,
      },
      bootstrapDependencies.ledgerReads
    );
  });

  it("passes the details search filter to both summary and entries", async () => {
    await getLedgerPageBootstrap({
      initialTab: "details",
      periodParams: {
        period: "custom",
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      },
      advancedFilters: { search: "  coffee " },
      ledgerDto: createPreAuthorizedLedgerDto(),
    });

    expect(calculateLedgerStatsMock).toHaveBeenCalledWith(
      "ledger-1",
      { search: "coffee", startDate: "2026-03-01", endDate: "2026-03-31" },
      bootstrapDependencies.ledgerReads
    );
    expect(listLedgerEntriesMock).toHaveBeenCalledWith(
      "ledger-1",
      {
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        search: "coffee",
        cursor: undefined,
        limit: 50,
      },
      bootstrapDependencies.ledgerReads
    );
  });

  it("prefetches stats tab enhanced stats with the ledger main currency", async () => {
    const result = await getLedgerPageBootstrap({
      initialTab: "stats",
      periodParams: { period: "thisMonth" },
      ledgerDto: createPreAuthorizedLedgerDto(),
    });

    expect(getEnhancedStatsMock).toHaveBeenCalledOnce();
    expect(calculateLedgerStatsMock).not.toHaveBeenCalled();
    expect(getSourceDocumentCountsQueryMock).not.toHaveBeenCalled();
    expect(listLedgerEntriesMock).not.toHaveBeenCalled();
    const statsQuery = result?.dehydratedState.queries.find(
      (query) => query.queryKey[0] === "ledger" && query.queryKey[1] === "enhanced-stats"
    );
    expect(statsQuery?.queryKey).toEqual([
      "ledger",
      "enhanced-stats",
      expect.objectContaining({
        rangeType: "month",
        comparisonMode: "same_period",
        mainCurrency: "USD",
      }),
    ]);
    expect(getEnhancedStatsMock).toHaveBeenCalledWith(
      "ledger-1",
      expect.objectContaining({
        queryRange: expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
        compareRange: expect.objectContaining({
          from: expect.any(String),
          to: expect.any(String),
        }),
      }),
      bootstrapDependencies.stats
    );
  });

  it("prefetches stats with the full unified query key used by the stats tab", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T12:00:00Z"));
    try {
      const result = await getLedgerPageBootstrap({
        initialTab: "stats",
        periodParams: { period: "thisMonth" },
        ledgerDto: createPreAuthorizedLedgerDto(),
      });

      const statsQuery = result?.dehydratedState.queries.find(
        (query) => query.queryKey[0] === "ledger" && query.queryKey[1] === "enhanced-stats"
      );
      expect(statsQuery).toBeDefined();

      const expectedDescriptor = buildStatsQueryDescriptor({
        currentDate: new Date("2026-08-06T12:00:00Z"),
        mainCurrency: "USD",
      });
      expect(statsQuery?.queryKey).toEqual(expectedDescriptor.queryKey);
      expect(statsQuery?.queryKey).toHaveLength(3);
      expect(statsQuery?.queryKey[0]).toBe("ledger");
      expect(statsQuery?.queryKey[1]).toBe("enhanced-stats");
      expect(statsQuery?.queryKey[2]).toEqual(
        expect.objectContaining({
          startDate: expect.any(String),
          endDate: expect.any(String),
          compareStartDate: expect.any(String),
          compareEndDate: expect.any(String),
          rangeType: expect.any(String),
          comparisonMode: expect.any(String),
          mainCurrency: expect.any(String),
        })
      );
      expect(getEnhancedStatsMock).toHaveBeenCalledWith(
        "ledger-1",
        expectedDescriptor.input,
        bootstrapDependencies.stats
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the URL stats range and offset for bootstrap prefetch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T12:00:00Z"));
    try {
      const result = await getLedgerPageBootstrap({
        initialTab: "stats",
        periodParams: { period: "thisMonth" },
        statsState: { range: "year", offset: -2, view: "trend" },
        ledgerDto: createPreAuthorizedLedgerDto(),
      });
      const statsQuery = result?.dehydratedState.queries.find(
        (query) => query.queryKey[0] === "ledger" && query.queryKey[1] === "enhanced-stats"
      );

      expect(statsQuery?.queryKey[2]).toMatchObject({
        rangeType: "year",
        startDate: "2024-01-01",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a ledger initialized with the Chinese defaults", async () => {
    const dto = {
      ...createPreAuthorizedLedgerDto(),
      settings: getDefaultLedger().settings,
    };
    const result = await getLedgerPageBootstrap({
      initialTab: "stream",
      periodParams: { period: "thisMonth" },
      ledgerDto: dto,
    });

    expect(result).not.toBeNull();
  });

  describe("book zone precedence", () => {
    it("dates the page by the viewed book's own zone", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-06T16:30:00Z"));
      try {
        listBooksMock.mockResolvedValue([
          {
            id: "book-1",
            name: "共同支出",
            timeZone: "Asia/Shanghai",
            sortOrder: 1,
          },
        ]);
        const result = await getLedgerPageBootstrap({
          initialTab: "stream",
          periodParams: { period: "thisMonth" },
          ledgerDto: createPreAuthorizedLedgerDto(),
          deviceTimeZone: "Europe/London",
          bookId: "book-1",
        });

        // 16:30 UTC is 00:30 in Shanghai (the next day) but still 17:30 in
        // London. The viewed book's own zone beats the device's.
        expect(result?.ledgerToday).toBe("2026-08-07");
      } finally {
        vi.useRealTimers();
      }
    });

    it("dates 总账 by the device zone", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-06T16:30:00Z"));
      try {
        const result = await getLedgerPageBootstrap({
          initialTab: "stats",
          periodParams: { period: "thisMonth" },
          ledgerDto: createPreAuthorizedLedgerDto(),
          deviceTimeZone: "Asia/Tokyo",
        });

        // 16:30 UTC is 01:30 in Tokyo (the next day) but still 00:30 in the
        // deployment default (Asia/Shanghai). No single book owns 总账, so the
        // device that asked is what the tab uses.
        expect(result?.ledgerToday).toBe("2026-08-07");
      } finally {
        vi.useRealTimers();
      }
    });

    it("reads no dates at all when neither the book nor the request names a zone", async () => {
      vi.stubEnv("TZ", "UTC");
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-30T16:30:00Z"));
      try {
        const result = await getLedgerPageBootstrap({
          initialTab: "stream",
          periodParams: { period: "thisMonth" },
          ledgerDto: createPreAuthorizedLedgerDto(),
          // A device that has not reported yet, which is every first visit.
          deviceTimeZone: null,
        });

        // 16:30 UTC on the 30th is already the 1st of October for the device
        // that is about to load this page. Dating the prefetch by the
        // deployment's own zone would spend a round trip on September data
        // the tab never asks for.
        expect(result?.ledgerToday).toBeUndefined();
        expect(listStreamPageMock).not.toHaveBeenCalled();
        expect(getStreamTotalMock).not.toHaveBeenCalled();
        expect(calculateLedgerStatsMock).not.toHaveBeenCalled();
        expect(getEnhancedStatsMock).not.toHaveBeenCalled();
        // Everything undated still loads, so the shell is usable meanwhile.
        expect(result?.initialBooks).toHaveLength(1);
        expect(listEntryCategoriesMock).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
        vi.unstubAllEnvs();
      }
    });

    it("prefetches the stats tab for the remembered book, not only for 总账", async () => {
      const result = await getLedgerPageBootstrap({
        initialTab: "stats",
        periodParams: { period: "thisMonth" },
        statsState: { range: "month", offset: 0, view: "heatmap" },
        ledgerDto: createPreAuthorizedLedgerDto(),
        bookId: "book-1",
      });

      const statsQuery = result?.dehydratedState.queries.find(
        (query) => query.queryKey[0] === "ledger" && query.queryKey[1] === "enhanced-stats"
      );
      expect(statsQuery?.queryKey[2]).toMatchObject({ bookId: "book-1" });
      expect(getEnhancedStatsMock).toHaveBeenCalledWith(
        "ledger-1",
        expect.objectContaining({ bookId: "book-1" }),
        bootstrapDependencies.stats
      );
      expect(result?.initialBookId).toBe("book-1");
    });

    it("prefetches 总账 when the remembered book is no longer live", async () => {
      const result = await getLedgerPageBootstrap({
        initialTab: "stats",
        periodParams: { period: "thisMonth" },
        statsState: { range: "month", offset: 0, view: "heatmap" },
        ledgerDto: createPreAuthorizedLedgerDto(),
        // The live list holds only book-1; this id was archived after the
        // choice was made. The client resets the scope, and the prefetch must
        // match it.
        bookId: "book-archived",
      });

      const statsQuery = result?.dehydratedState.queries.find(
        (query) => query.queryKey[0] === "ledger" && query.queryKey[1] === "enhanced-stats"
      );
      expect(statsQuery?.queryKey[2]).toMatchObject({ bookId: null });
      expect(getEnhancedStatsMock).toHaveBeenCalledWith(
        "ledger-1",
        expect.not.objectContaining({ bookId: expect.any(String) }),
        bootstrapDependencies.stats
      );
      expect(result?.initialBookId).toBeNull();
    });
  });

  it("does not prefetch a multi-ledger list for the single-ledger workspace", async () => {
    const result = await getLedgerPageBootstrap({
      initialTab: "stream",
      periodParams: { period: "thisMonth" },
      ledgerDto: createPreAuthorizedLedgerDto(),
    });

    expect(result).not.toBeNull();
    expect(result?.dehydratedState.queries.some((query) => query.queryKey[0] === "ledgers")).toBe(
      false
    );
  });

  it("prefetches stream query with the correct infinite query key structure", async () => {
    const result = await getLedgerPageBootstrap({
      initialTab: "stream",
      periodParams: { period: "thisMonth" },
      ledgerDto: createPreAuthorizedLedgerDto(),
    });

    expect(result).not.toBeNull();

    // The stream query should be in the dehydrated state as an infinite query
    const streamQuery = result?.dehydratedState.queries.find(
      (q) =>
        Array.isArray(q.queryKey) &&
        q.queryKey[0] === "ledger" &&
        q.queryKey[1] === "source-documents" &&
        q.queryKey[2] === "stream"
    );
    expect(streamQuery).toBeDefined();
    expect(streamQuery?.state.data).toEqual({
      pages: [{ items: [], nextCursor: null, generation: "1" }],
      pageParams: [undefined],
    });
  });

  /**
   * The product rule the deferral above serves: the viewed book's fixed zone
   * wins, then the device's, then the deployment's. The first visit has no
   * device answer yet, and 16:30 UTC on the 30th is a different day — and a
   * different month for a monthly period — in Shanghai than it is in UTC.
   */
  describe("the zone a first visit is dated by", () => {
    beforeEach(() => {
      vi.stubEnv("TZ", "UTC");
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-30T16:30:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    it("uses the device zone the browser reported rather than the deployment's", async () => {
      const result = await getLedgerPageBootstrap({
        initialTab: "stream",
        periodParams: { period: "thisMonth" },
        ledgerDto: createPreAuthorizedLedgerDto(),
        deviceTimeZone: "Asia/Shanghai",
      });

      // October for the device, where the deployment's UTC would still say
      // September: the range the client is about to ask for, so hydration is a
      // cache hit instead of a second request for the wrong month.
      expect(result?.ledgerToday).toBe("2026-10-01");
      expect(listStreamPageMock).toHaveBeenCalledWith(
        "ledger-1",
        { startDate: "2026-10-01", endDate: "2026-10-31", cursor: undefined, limit: 20 },
        bootstrapDependencies.sourceDocuments
      );
      expect(getStreamTotalMock).toHaveBeenCalledWith(
        "ledger-1",
        { startDate: "2026-10-01", endDate: "2026-10-31" },
        bootstrapDependencies.sourceDocuments.documents
      );
      const streamQuery = result?.dehydratedState.queries.find(
        (query) => query.queryKey[1] === "source-documents" && query.queryKey[2] === "stream"
      );
      expect(streamQuery?.queryKey[3]).toMatchObject({
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      });
    });

    it("treats a device zone the runtime cannot format with as no zone at all", async () => {
      const result = await getLedgerPageBootstrap({
        initialTab: "stream",
        periodParams: { period: "thisMonth" },
        ledgerDto: createPreAuthorizedLedgerDto(),
        // A forged or stale cookie is external input; it is not handed to the
        // date formatters and it does not stand in for a known zone.
        deviceTimeZone: "Not/AZone",
      });

      expect(result?.ledgerToday).toBeUndefined();
      expect(listStreamPageMock).not.toHaveBeenCalled();
    });

    it("dates 总账 by the device and does not inherit a book's fixed zone", async () => {
      listBooksMock.mockResolvedValue([
        {
          id: "book-1",
          name: "共同支出",
          timeZone: "Asia/Shanghai",
          sortOrder: 1,
        },
      ]);

      const result = await getLedgerPageBootstrap({
        initialTab: "stream",
        periodParams: { period: "thisMonth" },
        ledgerDto: createPreAuthorizedLedgerDto(),
        deviceTimeZone: "Europe/London",
        // No book: 总账 shows every book at once, so no single book's zone owns
        // the view.
      });

      expect(result?.ledgerToday).toBe("2026-09-30");
      expect(result?.initialBookId).toBeNull();
      expect(listStreamPageMock).toHaveBeenCalledWith(
        "ledger-1",
        { startDate: "2026-09-01", endDate: "2026-09-30", cursor: undefined, limit: 20 },
        bootstrapDependencies.sourceDocuments
      );
    });

    it("lets a viewed book's fixed zone beat the device zone across the month boundary", async () => {
      listBooksMock.mockResolvedValue([
        {
          id: "book-1",
          name: "共同支出",
          timeZone: "Europe/London",
          sortOrder: 1,
        },
      ]);

      const result = await getLedgerPageBootstrap({
        initialTab: "stream",
        periodParams: { period: "thisMonth" },
        ledgerDto: createPreAuthorizedLedgerDto(),
        deviceTimeZone: "Asia/Shanghai",
        bookId: "book-1",
      });

      // Shanghai is already into October; the book the page is narrowed to is
      // not, and the book is the authority for its own records.
      expect(result?.ledgerToday).toBe("2026-09-30");
      expect(listStreamPageMock).toHaveBeenCalledWith(
        "ledger-1",
        {
          bookId: "book-1",
          startDate: "2026-09-01",
          endDate: "2026-09-30",
          cursor: undefined,
          limit: 20,
        },
        bootstrapDependencies.sourceDocuments
      );
    });
  });

  it("does not dehydrate a first stream page that remains restart-required", async () => {
    listStreamPageMock.mockResolvedValue({
      items: [],
      nextCursor: null,
      generation: "1",
      restartRequired: true,
      hasTransitionalWork: false,
    });

    const result = await getLedgerPageBootstrap({
      initialTab: "stream",
      periodParams: { period: "thisMonth" },
      ledgerDto: createPreAuthorizedLedgerDto(),
    });

    expect(listStreamPageMock).toHaveBeenCalledTimes(2);
    expect(
      result?.dehydratedState.queries.some(
        (query) => query.queryKey[1] === "source-documents" && query.queryKey[2] === "stream"
      )
    ).toBe(false);
    expect(
      result?.dehydratedState.queries.some(
        (query) => query.queryKey[1] === "source-documents" && query.queryKey[2] === "refresh"
      )
    ).toBe(false);
  });
});
