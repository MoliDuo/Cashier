import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnifiedStreamGroup } from "@/modules/source-document/stream-grouping";
import { LedgerEntriesUnifiedGroups } from "@/modules/workspace/ui/UnifiedStreamGroups";

const { cardProps } = vi.hoisted(() => ({ cardProps: vi.fn() }));
vi.mock("@/modules/source-document/ui/SourceDocumentCard", () => ({
  SourceDocumentCard: (props: unknown) => {
    cardProps(props);
    return <div>Source document</div>;
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function largeGroup(count: number): UnifiedStreamGroup {
  return {
    date: "2026-07-15",
    total: "0",
    unconvertedCount: 0,
    currencyTotals: {},
    items: Array.from({ length: count }, (_, index) => ({
      sourceDocument: {
        id: `document-${index}`,
        version: 1,
        updatedAt: "2026-07-15T00:00:00.000Z",
        status: "completed",
      },
      ledgerEntries: [],
      documentDate: "2026-07-15",
    })),
  } as unknown as UnifiedStreamGroup;
}

describe("LedgerEntriesUnifiedGroups", () => {
  it("renders stream groups correctly", () => {
    cardProps.mockClear();
    const group: UnifiedStreamGroup = {
      date: "2026-07-15",
      total: "12",
      unconvertedCount: 0,
      currencyTotals: {},
      items: [
        {
          sourceDocument: {
            id: "document-1",
            status: "completed",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          ledgerEntries: [],
          documentDate: "2026-07-15",
        },
      ],
    };

    render(
      <LedgerEntriesUnifiedGroups
        streamGroups={[group]}
        mainCurrency="CNY"
        onViewSourceDetail={vi.fn()}
        onDeleteSourceConfirm={vi.fn()}
        isSelectionMode={false}
        selectedIds={[]}
        onToggleSelection={vi.fn()}
      />
    );

    expect(screen.getByText("Source document")).toBeInTheDocument();
    expect(cardProps).toHaveBeenCalledWith(expect.objectContaining({ defaultExpanded: true }));
  });

  it("renders the date alone for a submission-date group", () => {
    const group = {
      date: "2026-07-15",
      total: "0",
      unconvertedCount: 0,
      currencyTotals: {},
      items: [
        {
          sourceDocument: { id: "document-1", status: "processing" },
          ledgerEntries: [],
          documentDate: "2026-07-15",
        },
      ],
    } as unknown as UnifiedStreamGroup;

    render(
      <LedgerEntriesUnifiedGroups
        streamGroups={[group]}
        mainCurrency="CNY"
        onViewSourceDetail={vi.fn()}
        onDeleteSourceConfirm={vi.fn()}
        isSelectionMode={false}
        selectedIds={[]}
        onToggleSelection={vi.fn()}
      />
    );

    const header = screen.getByRole("heading", { level: 3 });
    expect(header.textContent).not.toBe("");
    expect(header.textContent).not.toContain("提交");
  });

  it("passes the ledger collapse preference to cards", () => {
    const group = {
      date: "2026-07-15",
      total: "0",
      unconvertedCount: 0,
      currencyTotals: {},
      items: [
        {
          sourceDocument: { id: "document-1", status: "completed" },
          ledgerEntries: [],
          documentDate: "2026-07-15",
        },
      ],
    } as unknown as UnifiedStreamGroup;
    cardProps.mockClear();
    render(
      <LedgerEntriesUnifiedGroups
        streamGroups={[group]}
        mainCurrency="CNY"
        onViewSourceDetail={vi.fn()}
        onDeleteSourceConfirm={vi.fn()}
        isSelectionMode={false}
        selectedIds={[]}
        onToggleSelection={vi.fn()}
        collapseEntriesDefault
      />
    );
    expect(cardProps).toHaveBeenCalledWith(expect.objectContaining({ defaultExpanded: false }));
  });

  it("disables only unselected stream cards at the selection limit", () => {
    const group = {
      date: "2026-07-15",
      total: "0",
      unconvertedCount: 0,
      currencyTotals: {},
      items: [
        {
          sourceDocument: { id: "document-1", status: "completed" },
          ledgerEntries: [],
          documentDate: "2026-07-15",
        },
        {
          sourceDocument: { id: "document-2", status: "completed" },
          ledgerEntries: [],
          documentDate: "2026-07-15",
        },
      ],
    } as unknown as UnifiedStreamGroup;
    cardProps.mockClear();

    render(
      <LedgerEntriesUnifiedGroups
        streamGroups={[group]}
        mainCurrency="CNY"
        onViewSourceDetail={vi.fn()}
        onDeleteSourceConfirm={vi.fn()}
        isSelectionMode
        selectedIds={["document-1"]}
        disableUnselected
        onToggleSelection={vi.fn()}
      />
    );

    expect(cardProps).toHaveBeenCalledWith(
      expect.objectContaining({ isSelected: true, selectionDisabled: false })
    );
    expect(cardProps).toHaveBeenCalledWith(
      expect.objectContaining({ isSelected: false, selectionDisabled: true })
    );
  });

  it("only rerenders the stream row whose selected state changed", () => {
    const firstItem = {
      sourceDocument: { id: "document-1", status: "completed" },
      ledgerEntries: [],
      documentDate: "2026-07-15",
    };
    const secondItem = {
      sourceDocument: { id: "document-2", status: "completed" },
      ledgerEntries: [],
      documentDate: "2026-07-15",
    };
    const groups = [
      {
        date: "2026-07-15",
        total: "0",
        unconvertedCount: 0,
        currencyTotals: {},
        items: [firstItem, secondItem],
      },
    ] as unknown as UnifiedStreamGroup[];
    const onViewSourceDetail = vi.fn();
    const onDeleteSourceConfirm = vi.fn();
    const onToggleSelection = vi.fn();
    cardProps.mockClear();

    const { rerender } = render(
      <LedgerEntriesUnifiedGroups
        streamGroups={groups}
        mainCurrency="CNY"
        onViewSourceDetail={onViewSourceDetail}
        onDeleteSourceConfirm={onDeleteSourceConfirm}
        isSelectionMode
        selectedIds={[]}
        onToggleSelection={onToggleSelection}
      />
    );
    expect(cardProps).toHaveBeenCalledTimes(2);

    rerender(
      <LedgerEntriesUnifiedGroups
        streamGroups={groups}
        mainCurrency="CNY"
        onViewSourceDetail={onViewSourceDetail}
        onDeleteSourceConfirm={onDeleteSourceConfirm}
        isSelectionMode
        selectedIds={["document-1"]}
        onToggleSelection={onToggleSelection}
      />
    );

    expect(cardProps).toHaveBeenCalledTimes(3);
    expect(cardProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceDocument: firstItem.sourceDocument,
        isSelected: true,
      })
    );
  });

  it("only rerenders the stream row whose recovery state changed", () => {
    const groups = [
      {
        date: "2026-07-15",
        total: "0",
        unconvertedCount: 0,
        currencyTotals: {},
        items: [
          {
            sourceDocument: {
              id: "document-1",
              version: 1,
              status: "failed",
            },
            ledgerEntries: [],
            documentDate: "2026-07-15",
          },
          {
            sourceDocument: {
              id: "document-2",
              version: 1,
              status: "failed",
            },
            ledgerEntries: [],
            documentDate: "2026-07-15",
          },
        ],
      },
    ] as unknown as UnifiedStreamGroup[];
    const retry = vi.fn(async () => undefined);
    const cancelProcessing = vi.fn(async () => undefined);
    const commonProps = {
      streamGroups: groups,
      mainCurrency: "CNY",
      onViewSourceDetail: vi.fn(),
      onDeleteSourceConfirm: vi.fn(),
      isSelectionMode: false,
      selectedIds: [],
      onToggleSelection: vi.fn(),
      noRecordsText: "No records",
      getItemProps: () => ({}),
    };
    cardProps.mockClear();

    const { rerender } = render(
      <LedgerEntriesUnifiedGroups
        {...commonProps}
        recovery={{
          retryingIds: new Set(),
          cancellingIds: new Set(),
          retry,
          cancelProcessing,
        }}
      />
    );
    expect(cardProps).toHaveBeenCalledTimes(2);

    rerender(
      <LedgerEntriesUnifiedGroups
        {...commonProps}
        recovery={{
          retryingIds: new Set(["document-1"]),
          cancellingIds: new Set(),
          retry,
          cancelProcessing,
        }}
      />
    );

    expect(cardProps).toHaveBeenCalledTimes(3);
    expect(cardProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceDocument: groups[0]!.items[0]!.sourceDocument,
        isRetrying: true,
      })
    );
  });

  it("renders every loaded bill, with no virtual window", () => {
    render(
      <LedgerEntriesUnifiedGroups
        streamGroups={[largeGroup(120)]}
        mainCurrency="CNY"
        onViewSourceDetail={vi.fn()}
        onDeleteSourceConfirm={vi.fn()}
        isSelectionMode={false}
        selectedIds={[]}
        onToggleSelection={vi.fn()}
      />
    );

    expect(screen.getAllByText("Source document")).toHaveLength(120);
  });

  it("fades in only the bills that arrive after the list first showed", () => {
    const props = {
      mainCurrency: "CNY",
      onViewSourceDetail: vi.fn(),
      onDeleteSourceConfirm: vi.fn(),
      isSelectionMode: false,
      selectedIds: [],
      onToggleSelection: vi.fn(),
    };
    const first = largeGroup(2);
    const { container, rerender } = render(
      <LedgerEntriesUnifiedGroups streamGroups={[first]} {...props} />
    );
    expect(container.querySelectorAll(".stream-card-enter")).toHaveLength(0);

    const arrived = largeGroup(3);
    rerender(<LedgerEntriesUnifiedGroups streamGroups={[arrived]} {...props} />);

    const entering = container.querySelectorAll(".stream-card-enter");
    expect(entering).toHaveLength(1);
    expect(entering[0]).toHaveAttribute("data-stream-card-id", "document-2");
  });
});
