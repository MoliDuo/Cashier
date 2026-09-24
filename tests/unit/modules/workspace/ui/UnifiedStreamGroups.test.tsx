import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnifiedStreamGroup } from "@/modules/source-document/stream-grouping";
import { LedgerEntriesUnifiedGroups } from "@/modules/workspace/ui/UnifiedStreamGroups";

const { cardProps, useStreamListMotionMock, virtualizerOptions } = vi.hoisted(() => ({
  cardProps: vi.fn(),
  virtualizerOptions: vi.fn(),
  useStreamListMotionMock: vi.fn(() => ({
    entering: new Set<string>(),
    exiting: [],
    updated: new Set<string>(),
    reducedMotion: false,
    registerNode: vi.fn(),
  })),
}));
vi.mock("@/modules/source-document/ui/SourceDocumentCard", () => ({
  SourceDocumentCard: (props: unknown) => {
    cardProps(props);
    return <div>Source document</div>;
  },
}));
vi.mock("@/modules/workspace/ui/use-stream-list-motion", () => ({
  useStreamListMotion: useStreamListMotionMock,
}));
vi.mock("@tanstack/react-virtual", () => ({
  useWindowVirtualizer: (options: { count: number; scrollMargin: number }) => {
    virtualizerOptions(options);
    return {
      getTotalSize: () => options.count * 88,
      getVirtualItems: () =>
        Array.from({ length: Math.min(options.count, 10) }, (_, index) => ({
          index,
          start: index * 88,
        })),
      measureElement: vi.fn(),
    };
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function largeGroup(count: number): UnifiedStreamGroup {
  return {
    date: "2026-07-15",
    dateProvenance: "transaction",
    total: "0",
    unconvertedCount: 0,
    currencyTotals: {},
    items: Array.from({ length: count }, (_, index) => ({
      sourceDocument: {
        id: `document-${index}`,
        ledgerId: "ledger-1",
        version: 1,
        updatedAt: "2026-07-15T00:00:00.000Z",
        status: "completed",
      },
      ledgerEntries: [],
      effectiveDate: "2026-07-15",
      dateProvenance: "transaction" as const,
    })),
  } as unknown as UnifiedStreamGroup;
}

describe("LedgerEntriesUnifiedGroups", () => {
  it("renders stream groups correctly", () => {
    cardProps.mockClear();
    const group: UnifiedStreamGroup = {
      date: "2026-07-15",
      dateProvenance: "transaction",
      total: "12",
      unconvertedCount: 0,
      currencyTotals: {},
      items: [
        {
          sourceDocument: {
            id: "document-1",
            ledgerId: "ledger-1",
            status: "completed",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          ledgerEntries: [],
          effectiveDate: "2026-07-15",
          dateProvenance: "transaction",
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
      dateProvenance: "submitted" as const,
      total: "0",
      unconvertedCount: 0,
      currencyTotals: {},
      items: [
        {
          sourceDocument: { id: "document-1", ledgerId: "ledger-1", status: "processing" },
          ledgerEntries: [],
          effectiveDate: "2026-07-15",
          dateProvenance: "submitted" as const,
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
      dateProvenance: "transaction" as const,
      total: "0",
      unconvertedCount: 0,
      currencyTotals: {},
      items: [
        {
          sourceDocument: { id: "document-1", status: "completed" },
          ledgerEntries: [],
          effectiveDate: "2026-07-15",
          dateProvenance: "transaction" as const,
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
      dateProvenance: "transaction" as const,
      total: "0",
      unconvertedCount: 0,
      currencyTotals: {},
      items: [
        {
          sourceDocument: { id: "document-1", ledgerId: "ledger-1", status: "completed" },
          ledgerEntries: [],
          effectiveDate: "2026-07-15",
          dateProvenance: "transaction" as const,
        },
        {
          sourceDocument: { id: "document-2", ledgerId: "ledger-1", status: "completed" },
          ledgerEntries: [],
          effectiveDate: "2026-07-15",
          dateProvenance: "transaction" as const,
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
      sourceDocument: { id: "document-1", ledgerId: "ledger-1", status: "completed" },
      ledgerEntries: [],
      effectiveDate: "2026-07-15",
      dateProvenance: "transaction" as const,
    };
    const secondItem = {
      sourceDocument: { id: "document-2", ledgerId: "ledger-1", status: "completed" },
      ledgerEntries: [],
      effectiveDate: "2026-07-15",
      dateProvenance: "transaction" as const,
    };
    const groups = [
      {
        date: "2026-07-15",
        dateProvenance: "transaction" as const,
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
        dateProvenance: "transaction" as const,
        total: "0",
        unconvertedCount: 0,
        currencyTotals: {},
        items: [
          {
            sourceDocument: {
              id: "document-1",
              ledgerId: "ledger-1",
              version: 1,
              status: "failed",
            },
            ledgerEntries: [],
            effectiveDate: "2026-07-15",
            dateProvenance: "transaction" as const,
          },
          {
            sourceDocument: {
              id: "document-2",
              ledgerId: "ledger-1",
              version: 1,
              status: "failed",
            },
            ledgerEntries: [],
            effectiveDate: "2026-07-15",
            dateProvenance: "transaction" as const,
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

  it("keeps FLIP motion through 80 documents and virtualizes the 81st", () => {
    useStreamListMotionMock.mockClear();
    const commonProps = {
      mainCurrency: "CNY",
      onViewSourceDetail: vi.fn(),
      onDeleteSourceConfirm: vi.fn(),
      isSelectionMode: false,
      selectedIds: [],
      onToggleSelection: vi.fn(),
      noRecordsText: "No records",
      getItemProps: () => ({}),
    };
    const { rerender } = render(
      <LedgerEntriesUnifiedGroups streamGroups={[largeGroup(80)]} {...commonProps} />
    );
    expect(useStreamListMotionMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("virtualized-source-document-stream")).not.toBeInTheDocument();

    rerender(<LedgerEntriesUnifiedGroups streamGroups={[largeGroup(81)]} {...commonProps} />);
    expect(screen.getByTestId("virtualized-source-document-stream")).toBeInTheDocument();
    expect(useStreamListMotionMock).toHaveBeenCalledTimes(1);
  });

  it("mounts only the virtual window for a 500-document stream", () => {
    cardProps.mockClear();
    const commonProps = {
      mainCurrency: "CNY",
      onViewSourceDetail: vi.fn(),
      onDeleteSourceConfirm: vi.fn(),
      isSelectionMode: false,
      selectedIds: [],
      onToggleSelection: vi.fn(),
      noRecordsText: "No records",
      getItemProps: () => ({}),
      collapseEntriesDefault: true,
    };
    render(<LedgerEntriesUnifiedGroups streamGroups={[largeGroup(500)]} {...commonProps} />);
    expect(screen.getByTestId("virtualized-source-document-stream")).toBeInTheDocument();
    expect(cardProps.mock.calls.length).toBeGreaterThan(0);
    expect(cardProps.mock.calls.length).toBeLessThan(500);
    expect(cardProps).toHaveBeenCalledWith(
      expect.objectContaining({ expanded: false, onExpandedChange: expect.any(Function) })
    );
  });

  it("remeasures the window offset when preceding content changes size", () => {
    let top = 120;
    let notifyResize: (() => void) | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          notifyResize = callback;
        }
        observe = observe;
        disconnect = disconnect;
      }
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement
    ) {
      const elementTop = this.dataset.testid === "virtualized-source-document-stream" ? top : 0;
      return {
        top: elementTop,
        bottom: elementTop,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: elementTop,
        toJSON: () => ({}),
      };
    });
    virtualizerOptions.mockClear();

    const { unmount } = render(
      <div>
        <div data-testid="preceding-content" />
        <LedgerEntriesUnifiedGroups
          streamGroups={[largeGroup(81)]}
          mainCurrency="CNY"
          onViewSourceDetail={vi.fn()}
          onDeleteSourceConfirm={vi.fn()}
          isSelectionMode={false}
          selectedIds={[]}
          onToggleSelection={vi.fn()}
        />
      </div>
    );
    expect(virtualizerOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ scrollMargin: 120 })
    );
    expect(observe).toHaveBeenCalledWith(screen.getByTestId("preceding-content"));

    top = 240;
    act(() => notifyResize?.());
    expect(virtualizerOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ scrollMargin: 240 })
    );

    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
