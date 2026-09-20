import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultLedger } from "tests/helpers/default-ledger";
import type { BookPort, CategoryPort, ServiceCredentialPort } from "@/application/contracts";
import { getLedgerSettingsBootstrap as getBootstrap } from "@/modules/workspace/application/queries/get-ledger-settings-bootstrap";

const listEntryCategoriesMock = vi.hoisted(() => vi.fn());
const getLedgerSettingsViewMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/ledger/application/queries/list-entry-categories", () => ({
  listEntryCategories: listEntryCategoriesMock,
}));
vi.mock("@/modules/ledger/application/queries/get-ledger-settings-view", () => ({
  getLedgerSettingsView: getLedgerSettingsViewMock,
}));

const listBooksMock = vi.fn();

const dependencies = {
  categories: {
    listWithCount: vi.fn(),
    countUncategorized: vi.fn(),
  } satisfies Pick<CategoryPort, "listWithCount" | "countUncategorized">,
  credentials: { list: vi.fn() } satisfies Pick<ServiceCredentialPort, "list">,
  books: { list: listBooksMock } satisfies Pick<BookPort, "list">,
};

const ledgerDto = {
  id: "ledger-1",
  userId: "user-1",
  settings: { ...getDefaultLedger("en").settings, mainCurrency: "USD" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("getLedgerSettingsBootstrap", () => {
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
      },
    ]);
    getLedgerSettingsViewMock.mockResolvedValue({
      uncategorizedCount: 0,
      credentials: [],
    });
  });

  it("hydrates only ledger, categories, and settings queries", async () => {
    const result = await getBootstrap({ ledgerId: "ledger-1", ledgerDto }, dependencies);

    expect(result).not.toBeNull();
    expect(listEntryCategoriesMock).toHaveBeenCalledWith("ledger-1", dependencies.categories);
    expect(getLedgerSettingsViewMock).toHaveBeenCalledWith("ledger-1", {
      categories: dependencies.categories,
      credentials: dependencies.credentials,
    });
    expect(result?.dehydratedState.queries.map((query) => query.queryKey.slice(0, 3))).toEqual(
      expect.arrayContaining([
        ["ledger", "ledger-1"],
        ["ledger", "ledger-1", "categories"],
        ["ledger", "ledger-1", "settings"],
      ])
    );
    expect(
      result?.dehydratedState.queries.some((query) =>
        ["source-documents", "entries", "summary", "enhanced-stats"].includes(
          String(query.queryKey[2])
        )
      )
    ).toBe(false);
  });

  it("rejects a pre-authorized DTO for another ledger", async () => {
    await expect(
      getBootstrap({ ledgerId: "ledger-2", ledgerDto }, dependencies)
    ).resolves.toBeNull();
    expect(listEntryCategoriesMock).not.toHaveBeenCalled();
  });

  it("reads the books once and derives the switcher's list from it", async () => {
    listBooksMock.mockResolvedValue([
      {
        id: "book-1",
        ledgerId: "ledger-1",
        name: "共同支出",
        timeZone: null,
        sortOrder: 1,
        archivedAt: null,
      },
      {
        id: "book-2",
        ledgerId: "ledger-1",
        name: "旧账",
        timeZone: null,
        sortOrder: 2,
        archivedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const result = await getBootstrap({ ledgerId: "ledger-1", ledgerDto }, dependencies);

    expect(listBooksMock).toHaveBeenCalledTimes(1);
    expect(listBooksMock).toHaveBeenCalledWith("ledger-1", { includeArchived: true });
    expect(result?.initialBooks.map((book) => book.id)).toEqual(["book-1"]);
    expect(result?.initialBooksIncludingArchived.map((book) => book.id)).toEqual([
      "book-1",
      "book-2",
    ]);
    const booksQuery = result?.dehydratedState.queries.find(
      (query) => String(query.queryKey[2]) === "books"
    );
    expect((booksQuery?.state.data as { id: string }[]).map((book) => book.id)).toEqual(["book-1"]);
  });

  it("starts the categories and settings loads without waiting for the books", async () => {
    let releaseBooks!: (books: unknown[]) => void;
    listBooksMock.mockReturnValue(
      new Promise((resolve) => {
        releaseBooks = resolve;
      })
    );

    const pending = getBootstrap({ ledgerId: "ledger-1", ledgerDto }, dependencies);
    await Promise.resolve();
    await Promise.resolve();

    expect(listEntryCategoriesMock).toHaveBeenCalledTimes(1);
    expect(getLedgerSettingsViewMock).toHaveBeenCalledTimes(1);

    releaseBooks([]);
    await expect(pending).resolves.not.toBeNull();
  });
});
