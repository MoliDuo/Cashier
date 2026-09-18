import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerTabPanels } from "@/modules/workspace/ui/LedgerTabPanels";
import type { BookDto, Ledger } from "@/modules/ledger/contracts";
import { getDefaultLedger } from "tests/helpers/default-ledger";

/**
 * The deferred panels are the ones that take the book scope, so the recorder
 * stands in for all three and records whatever each panel is rendered with.
 */
const deferredProps = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));

vi.mock("next/dynamic", () => ({
  default: () => (props: Record<string, unknown>) => {
    deferredProps.calls.push(props);
    return null;
  },
}));

vi.mock("@/modules/workspace/ui/LedgerEntriesTab", () => ({
  LedgerEntriesTab: (props: Record<string, unknown>) => {
    deferredProps.calls.push(props);
    return null;
  },
}));

vi.mock("@/i18n/DeferredFeatureMessages", () => ({
  DeferredFeatureMessages: ({ children }: { children: unknown }) => children,
}));

vi.mock("@/components/skeletons/TabSkeletons", () => ({
  DetailsTabSkeleton: () => null,
  StatsTabSkeleton: () => null,
  SettingsTabSkeleton: () => null,
}));

const BOOK_ME = "10000000-0000-4000-8000-000000000001";
const BOOK_SHARED = "10000000-0000-4000-8000-000000000002";

const ledgerFixture: Ledger = {
  id: "ledger-1",
  settings: { ...getDefaultLedger().settings, mainCurrency: "CNY" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const books: BookDto[] = [
  {
    id: BOOK_ME,
    ledgerId: "ledger-1",
    name: "Mine",
    timeZone: null,
    sortOrder: 1,
    isDefault: true,
    archivedAt: null,
  },
  {
    id: BOOK_SHARED,
    ledgerId: "ledger-1",
    name: "Shared",
    timeZone: null,
    sortOrder: 2,
    isDefault: false,
    archivedAt: null,
  },
];

const baseProps = {
  recordScope: null,
  onRecordScopeChange: vi.fn(),
  books,
  hidden: false,
  locale: "en",
  ledgerId: "ledger-1",
  ledger: ledgerFixture,
  categories: [],
  periodParams: { period: "all" as const },
  onFiltersChange: vi.fn(),
  advancedFilters: {},
  onCategoryDrilldown: vi.fn(),
  onDateDrilldown: vi.fn(),
};

describe("LedgerTabPanels", () => {
  beforeEach(() => {
    deferredProps.calls.length = 0;
  });

  /** 总账 is the absence of a book, which each panel reads as "no filter". */
  it.each([
    ["stream", { bookId: undefined, scopeBookName: null }],
    ["details", { bookId: undefined, scopeBookName: null }],
    ["stats", { bookId: undefined }],
  ] as const)("forwards 总账 to the %s panel", (activeTab, expected) => {
    render(<LedgerTabPanels {...baseProps} activeTab={activeTab} />);

    expect(deferredProps.calls).toHaveLength(1);
    expect(deferredProps.calls[0]).toMatchObject({ ledgerId: "ledger-1", ...expected });
  });

  it("hands the stream panel the book id and name the scope resolved to", () => {
    render(<LedgerTabPanels {...baseProps} activeTab="stream" recordScope={BOOK_SHARED} />);

    expect(deferredProps.calls).toHaveLength(1);
    expect(deferredProps.calls[0]).toMatchObject({
      bookId: BOOK_SHARED,
      scopeBookName: "Shared",
      ledgerId: "ledger-1",
    });
  });

  it("hands 设置 the books it manages and no scope at all", () => {
    render(<LedgerTabPanels {...baseProps} activeTab="settings" recordScope={BOOK_ME} />);

    expect(deferredProps.calls).toHaveLength(1);
    expect(deferredProps.calls[0]).toMatchObject({ initialBooks: books });
    expect(deferredProps.calls[0]).not.toHaveProperty("bookId");
  });
});
