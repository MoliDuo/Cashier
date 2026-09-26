import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { DehydratedState } from "@tanstack/react-query";
import { getTestDb } from "tests/setup";
import {
  activateTestSourceDocumentProjection,
  createTestUserWithLedger,
} from "tests/helpers/schema-setup";
import { books, entryCategories, ledgerEntries, sourceDocuments } from "@/persistence";
import {
  getLedgerRouteBootstrap,
  getLedgerShellBootstrap,
  loadLedgerView,
} from "@/modules/workspace/server/ledger-page-bootstrap";
import { buildStatsQueryDescriptor } from "@/modules/workspace/ledger-tab-query-descriptors";
import { resolveAuthenticatedHome } from "@/modules/workspace/server/resolve-authenticated-home";
import { addPeriod, parseDateString } from "@/lib/date-utils";
import type { LedgerTab } from "@/lib/ledger-tabs";
import type { PeriodParams } from "@/lib/period-utils";
import type { LedgerAdvancedFilters } from "@/modules/workspace/initial-query-state";
import type { StatsUrlState } from "@/modules/workspace/stats-url-params";

const request = vi.hoisted(() => ({
  cookies: {} as Record<string, string>,
  failBooks: false,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = request.cookies[name];
      return value == null ? undefined : { name, value };
    },
  }),
}));

// The one failure this file injects: a books read that errors, which the page
// has to survive without losing the reader's remembered book.
vi.mock("@/modules/ledger/server/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/ledger/server/books")>();
  return {
    ...actual,
    listBooks: async (...args: Parameters<typeof actual.listBooks>) => {
      if (request.failBooks) throw new Error("books are down");
      return actual.listBooks(...args);
    },
  };
});

interface PageInput {
  tab: LedgerTab;
  periodParams?: PeriodParams;
  advancedFilters?: LedgerAdvancedFilters;
  statsState?: StatsUrlState;
  /** The book the scope cookie names. */
  bookId?: string;
  /** The zone the device cookie names; omitted for a first visit. */
  deviceTimeZone?: string;
}

/**
 * One document request: the layout's view and shell data, then the route's
 * first screen, composed the way the ledger layout and page compose them.
 */
async function loadPage(input: PageInput) {
  request.cookies = {
    ...(input.bookId == null ? {} : { CASHIER_BOOK_SCOPE: input.bookId }),
    ...(input.deviceTimeZone == null ? {} : { CASHIER_TIME_ZONE: input.deviceTimeZone }),
  };
  const view = await loadLedgerView();
  const { ledgerDto } = await resolveAuthenticatedHome();
  const [shell, route] = await Promise.all([
    getLedgerShellBootstrap({ ledgerDto, books: view.books, categories: view.categories }),
    getLedgerRouteBootstrap({
      tab: input.tab,
      ledgerDto,
      scope: view,
      ...(input.periodParams === undefined ? {} : { periodParams: input.periodParams }),
      ...(input.advancedFilters === undefined ? {} : { advancedFilters: input.advancedFilters }),
      ...(input.statsState === undefined ? {} : { statsState: input.statsState }),
    }),
  ]);
  return { view, shell, route };
}

function query(state: DehydratedState, ...prefix: string[]) {
  return state.queries.find((candidate) =>
    prefix.every((segment, index) => candidate.queryKey[index] === segment)
  );
}

function streamTitles(state: DehydratedState): string[] {
  const data = query(state, "ledger", "source-documents", "stream")?.state.data as
    { pages: Array<{ items: Array<{ title: string | null }> }> } | undefined;
  return (data?.pages ?? []).flatMap((page) => page.items.map((item) => item.title ?? ""));
}

function entryNames(state: DehydratedState): string[] {
  const data = query(state, "ledger", "entries")?.state.data as
    { pages: Array<{ items: Array<{ itemName: string }> }> } | undefined;
  return (data?.pages ?? []).flatMap((page) => page.items.map((item) => item.itemName)).sort();
}

describe("ledger page bootstrap", () => {
  let ledgerId = "";
  let bookId = "";
  let otherBookId = "";

  /** A parsed document with one entry per amount, filed into a book on a day. */
  async function seedDocument(input: {
    title: string;
    date: string;
    amounts: string[];
    book?: string;
  }): Promise<string> {
    const db = getTestDb();
    const [document] = await db
      .insert(sourceDocuments)
      .values({
        ledgerId,
        title: input.title,
        documentDate: input.date,
        bookId: input.book ?? bookId,
      })
      .returning({ id: sourceDocuments.id });
    await db.insert(ledgerEntries).values(
      input.amounts.map((amount, index) => ({
        ledgerId,
        sourceDocumentId: document!.id,
        amount,
        currency: "CNY",
        itemName: `${input.title} ${index + 1}`,
      }))
    );
    await activateTestSourceDocumentProjection(db, document!.id, { parsed: true });
    return document!.id;
  }

  async function setBookZone(id: string, timeZone: string | null) {
    await getTestDb().update(books).set({ timeZone }).where(eq(books.id, id));
  }

  beforeEach(async () => {
    request.cookies = {};
    request.failBooks = false;
    const db = getTestDb();
    ({ ledgerId } = await createTestUserWithLedger(db));
    [bookId] = await db
      .select({ id: books.id })
      .from(books)
      .where(eq(books.ledgerId, ledgerId))
      .then((rows) => rows.map((row) => row.id));
    [{ id: otherBookId }] = (await db
      .insert(books)
      .values({ ledgerId, name: "哞哞的", sortOrder: 2 })
      .returning({ id: books.id })) as [{ id: string }];
    await db.insert(entryCategories).values({ ledgerId, name: "吃喝", sortOrder: 1 });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T16:30:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dehydrates the ledger, its live books and its categories for the shell", async () => {
    const { shell, view } = await loadPage({ tab: "stream", deviceTimeZone: "Asia/Shanghai" });

    expect(query(shell, "ledger")?.state.data).toMatchObject({ id: ledgerId });
    expect(
      (query(shell, "ledger", "books")?.state.data as Array<{ id: string }>).map((b) => b.id)
    ).toEqual([bookId, otherBookId]);
    expect(query(shell, "ledger", "categories")?.state.data).toEqual([
      expect.objectContaining({ name: "吃喝" }),
    ]);
    expect(view.books).toHaveLength(2);
    expect(shell.queries.some((candidate) => candidate.queryKey[0] === "ledgers")).toBe(false);
  });

  it("prefetches the device's month of the stream, its total and the refresh baseline", async () => {
    await seedDocument({ title: "October lunch", date: "2026-10-01", amounts: ["30.00"] });
    await seedDocument({ title: "September lunch", date: "2026-09-30", amounts: ["20.00"] });

    // 16:30 UTC on the 30th is already October in Shanghai, where the
    // deployment's UTC would still say September.
    const { view, route } = await loadPage({ tab: "stream", deviceTimeZone: "Asia/Shanghai" });

    expect(view.ledgerToday).toBe("2026-10-01");
    expect(query(route, "ledger", "source-documents", "stream")?.queryKey[3]).toMatchObject({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
    expect(streamTitles(route)).toEqual(["October lunch"]);
    expect(query(route, "ledger", "source-documents", "stream-total")?.state.data).toMatchObject({
      total: "30",
    });
    expect(query(route, "ledger", "source-documents", "refresh")?.state.data).toMatchObject({
      changed: false,
      hasTransitionalWork: false,
    });
    expect(query(route, "ledger", "entries")).toBeUndefined();
    expect(query(route, "ledger", "enhanced-stats")).toBeUndefined();
  });

  it("applies the amount, status and search filters to the stream and its total", async () => {
    await seedDocument({ title: "coffee beans", date: "2026-09-10", amounts: ["50.00"] });
    await seedDocument({ title: "coffee cup", date: "2026-09-11", amounts: ["5.00"] });
    await seedDocument({ title: "tea", date: "2026-09-12", amounts: ["60.00"] });

    const { route } = await loadPage({
      tab: "stream",
      deviceTimeZone: "Europe/London",
      advancedFilters: {
        minAmount: "20",
        maxAmount: "100",
        search: "  coffee ",
        statuses: ["completed"],
      },
    });

    expect(streamTitles(route)).toEqual(["coffee beans"]);
    expect(query(route, "ledger", "source-documents", "stream-total")?.state.data).toMatchObject({
      total: "50",
    });
  });

  it("reads no dates at all when neither the book nor the request names a zone", async () => {
    await seedDocument({ title: "September lunch", date: "2026-09-30", amounts: ["20.00"] });

    for (const deviceTimeZone of [undefined, "Not/AZone"]) {
      const { view, shell, route } = await loadPage({
        tab: "stream",
        ...(deviceTimeZone == null ? {} : { deviceTimeZone }),
      });

      // A first visit, or a cookie the runtime cannot format with: dating the
      // prefetch by the deployment's zone could fetch a month the tab never
      // asks for, so the dated reads are left to the client.
      expect(view.ledgerToday).toBeUndefined();
      expect(route.queries).toEqual([]);
      expect(query(shell, "ledger", "books")).toBeDefined();
      expect(query(shell, "ledger", "categories")).toBeDefined();
    }
  });

  it("dates 总账 by the device and does not inherit a book's fixed zone", async () => {
    await setBookZone(bookId, "Asia/Shanghai");

    const { view, route } = await loadPage({ tab: "stream", deviceTimeZone: "Europe/London" });

    expect(view.bookId).toBeNull();
    expect(view.ledgerToday).toBe("2026-09-30");
    expect(query(route, "ledger", "source-documents", "stream")?.queryKey[3]).toMatchObject({
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
  });

  it("lets a viewed book's fixed zone beat the device zone across the month boundary", async () => {
    await setBookZone(otherBookId, "Europe/London");
    await seedDocument({ title: "Ours", date: "2026-09-20", amounts: ["10.00"] });
    await seedDocument({
      title: "Hers",
      date: "2026-09-20",
      amounts: ["10.00"],
      book: otherBookId,
    });

    const { view, route } = await loadPage({
      tab: "stream",
      deviceTimeZone: "Asia/Shanghai",
      bookId: otherBookId,
    });

    // Shanghai is already into October; the book the page is narrowed to is
    // not, and the book is the authority for its own records.
    expect(view.bookId).toBe(otherBookId);
    expect(view.ledgerToday).toBe("2026-09-30");
    expect(query(route, "ledger", "source-documents", "stream")?.queryKey[3]).toMatchObject({
      bookId: otherBookId,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(streamTitles(route)).toEqual(["Hers"]);
  });

  it("prefetches the details summary and entries with the advanced filters", async () => {
    await seedDocument({
      title: "Groceries",
      date: "2026-09-15",
      amounts: ["10.00", "50.00", "150.00"],
    });

    const { route } = await loadPage({
      tab: "details",
      deviceTimeZone: "Europe/London",
      periodParams: { period: "custom", startDate: "2026-09-01", endDate: "2026-09-30" },
      advancedFilters: { minAmount: "20", maxAmount: "100" },
    });

    expect(entryNames(route)).toEqual(["Groceries 2"]);
    expect(query(route, "ledger", "summary")?.state.data).toMatchObject({
      convertedTotal: expect.objectContaining({ total: "50" }),
    });
    expect(query(route, "ledger", "source-documents", "stream")).toBeUndefined();
  });

  it("prefetches stats under the key the stats tab asks for, for the remembered book", async () => {
    const { view, route } = await loadPage({
      tab: "stats",
      deviceTimeZone: "Europe/London",
      bookId,
      statsState: { range: "year", offset: -2, view: "trend" },
    });

    const expected = buildStatsQueryDescriptor({
      bookId,
      currentDate: addPeriod(parseDateString("2026-09-30"), "year", -2),
      mainCurrency: "CNY",
      rangeType: "year",
      currentPeriod: false,
    });
    const stats = query(route, "ledger", "enhanced-stats");
    expect(view.bookId).toBe(bookId);
    expect(stats?.queryKey).toEqual(expected.queryKey);
    expect(stats?.queryKey[2]).toMatchObject({
      bookId,
      rangeType: "year",
      startDate: "2024-01-01",
    });
    expect(stats?.state.status).toBe("success");
  });

  it("prefetches 总账 when the remembered book is no longer live", async () => {
    await getTestDb()
      .update(books)
      .set({ archivedAt: new Date() })
      .where(eq(books.id, otherBookId));

    const { view, route } = await loadPage({
      tab: "stats",
      deviceTimeZone: "Europe/London",
      bookId: otherBookId,
    });

    expect(view.bookId).toBeNull();
    expect(query(route, "ledger", "enhanced-stats")?.queryKey[2]).toMatchObject({ bookId: null });
  });

  it("prefetches the settings view for 设置", async () => {
    const { route } = await loadPage({ tab: "settings" });

    expect(route.queries.map((candidate) => candidate.queryKey)).toEqual([["ledger", "settings"]]);
    expect(route.queries[0]?.state.status).toBe("success");
  });

  it("keeps the remembered book and leaves dated reads to the client when the books fail", async () => {
    request.failBooks = true;

    const { view, shell, route } = await loadPage({
      tab: "stream",
      deviceTimeZone: "Europe/London",
      bookId: otherBookId,
    });

    // A list that failed is not evidence the book is gone; losing it would
    // quietly reset the reader to 总账.
    expect(view.bookId).toBe(otherBookId);
    expect(view.books).toBeNull();
    expect(view.ledgerToday).toBeUndefined();
    expect(route.queries).toEqual([]);
    expect(query(shell, "ledger", "books")).toBeUndefined();
    expect(query(shell, "ledger", "categories")).toBeDefined();
  });
});
