import { beforeEach, describe, expect, it, vi } from "vitest";
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
const getLedgerPageBootstrap = (
  input: Omit<Parameters<typeof getLedgerPageBootstrapUseCase>[0], "ledgerDto"> &
    Partial<Pick<Parameters<typeof getLedgerPageBootstrapUseCase>[0], "ledgerDto">>
) =>
  getLedgerPageBootstrapUseCase(
    {
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

vi.mock("@/modules/source-document/application/queries/get-source-document-counts", () => ({
  getSourceDocumentCountsQuery: getSourceDocumentCountsQueryMock,
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
    settings: { ...getDefaultLedger("en").settings, mainCurrency: "USD" },
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
        ledgerId: "ledger-1",
        name: "共同支出",
        timeZone: null,
        sortOrder: 1,
        isDefault: true,
      },
    ]);
    calculateLedgerStatsMock.mockResolvedValue({});
    listLedgerEntriesMock.mockResolvedValue({ items: [], nextCursor: null });
    getSourceDocumentCountsQueryMock.mockResolvedValue({ processingCount: 0, attentionCount: 0 });
    listStreamPageMock.mockResolvedValue({ items: [], nextCursor: null, generation: "1" });
    getStreamTotalMock.mockResolvedValue({ total: "0" });
    getEnhancedStatsMock.mockResolvedValue({});
  });

  it("rejects a pre-authorized DTO for another ledger", async () => {
    await expect(
      getLedgerPageBootstrap({
        ledgerId: "ledger-2",
        initialTab: "stream",
        periodParams: { period: "thisMonth" },
        ledgerDto: createPreAuthorizedLedgerDto(),
      })
    ).resolves.toBeNull();
    expect(listStreamPageMock).not.toHaveBeenCalled();
  });

  it("accepts a pre-authorized ledger DTO and skips re-authorization", async () => {
    const preAuthDto = createPreAuthorizedLedgerDto();
    const result = await getLedgerPageBootstrap({
      ledgerId: "ledger-1",
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
      ledgerId: "ledger-1",
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
      ledgerId: "ledger-1",
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
      ledgerId: "ledger-1",
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
      ledgerId: "ledger-1",
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
      ledgerId: "ledger-1",
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
      ledgerId: "ledger-1",
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
      ledgerId: "ledger-1",
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
      ledgerId: "ledger-1",
      initialTab: "stats",
      periodParams: { period: "thisMonth" },
      ledgerDto: createPreAuthorizedLedgerDto(),
    });

    expect(getEnhancedStatsMock).toHaveBeenCalledOnce();
    expect(calculateLedgerStatsMock).not.toHaveBeenCalled();
    expect(getSourceDocumentCountsQueryMock).not.toHaveBeenCalled();
    expect(listLedgerEntriesMock).not.toHaveBeenCalled();
    const statsQuery = result?.dehydratedState.queries.find(
      (query) =>
        query.queryKey[0] === "ledger" &&
        query.queryKey[1] === "ledger-1" &&
        query.queryKey[2] === "enhanced-stats"
    );
    expect(statsQuery?.queryKey).toEqual([
      "ledger",
      "ledger-1",
      "enhanced-stats",
      expect.objectContaining({
        rangeType: "month",
        comparisonMode: "same_period",
        mainCurrency: "USD",
      }),
    ]);
    expect(getEnhancedStatsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ledgerId: "ledger-1",
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
        ledgerId: "ledger-1",
        initialTab: "stats",
        periodParams: { period: "thisMonth" },
        ledgerDto: createPreAuthorizedLedgerDto(),
      });

      const statsQuery = result?.dehydratedState.queries.find(
        (query) =>
          query.queryKey[0] === "ledger" &&
          query.queryKey[1] === "ledger-1" &&
          query.queryKey[2] === "enhanced-stats"
      );
      expect(statsQuery).toBeDefined();

      const expectedDescriptor = buildStatsQueryDescriptor({
        ledgerId: "ledger-1",
        currentDate: new Date("2026-08-06T12:00:00Z"),
        mainCurrency: "USD",
      });
      expect(statsQuery?.queryKey).toEqual(expectedDescriptor.queryKey);
      expect(statsQuery?.queryKey).toHaveLength(4);
      expect(statsQuery?.queryKey[0]).toBe("ledger");
      expect(statsQuery?.queryKey[1]).toBe("ledger-1");
      expect(statsQuery?.queryKey[2]).toBe("enhanced-stats");
      expect(statsQuery?.queryKey[3]).toEqual(
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
        ledgerId: "ledger-1",
        initialTab: "stats",
        periodParams: { period: "thisMonth" },
        statsState: { range: "year", offset: -2, view: "trend" },
        ledgerDto: createPreAuthorizedLedgerDto(),
      });
      const statsQuery = result?.dehydratedState.queries.find(
        (query) =>
          query.queryKey[0] === "ledger" &&
          query.queryKey[1] === "ledger-1" &&
          query.queryKey[2] === "enhanced-stats"
      );

      expect(statsQuery?.queryKey[3]).toMatchObject({
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
      settings: getDefaultLedger("zh").settings,
    };
    const result = await getLedgerPageBootstrap({
      ledgerId: "ledger-1",
      initialTab: "stream",
      periodParams: { period: "thisMonth" },
      ledgerDto: dto,
    });

    expect(result).not.toBeNull();
  });

  it("does not prefetch a multi-ledger list for the single-ledger workspace", async () => {
    const result = await getLedgerPageBootstrap({
      ledgerId: "ledger-1",
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
      ledgerId: "ledger-1",
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
        q.queryKey[1] === "ledger-1" &&
        q.queryKey[2] === "source-documents" &&
        q.queryKey[3] === "stream"
    );
    expect(streamQuery).toBeDefined();
    expect(streamQuery?.state.data).toEqual({
      pages: [{ items: [], nextCursor: null, generation: "1" }],
      pageParams: [undefined],
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
      ledgerId: "ledger-1",
      initialTab: "stream",
      periodParams: { period: "thisMonth" },
      ledgerDto: createPreAuthorizedLedgerDto(),
    });

    expect(listStreamPageMock).toHaveBeenCalledTimes(2);
    expect(
      result?.dehydratedState.queries.some(
        (query) => query.queryKey[2] === "source-documents" && query.queryKey[3] === "stream"
      )
    ).toBe(false);
    expect(
      result?.dehydratedState.queries.some(
        (query) => query.queryKey[2] === "source-documents" && query.queryKey[3] === "refresh"
      )
    ).toBe(false);
  });
});
