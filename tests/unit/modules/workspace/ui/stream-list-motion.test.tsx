import { act, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceDocumentListItemDto } from "@/modules/source-document/contracts";
import type { UnifiedStreamGroup } from "@/modules/source-document/stream-grouping";
import { computeStreamListMotionDiff } from "@/modules/workspace/ui/stream-list-motion";
import { LedgerEntriesUnifiedGroups } from "@/modules/workspace/ui/UnifiedStreamGroups";

vi.mock("@/modules/source-document/ui/SourceDocumentCard", () => ({
  SourceDocumentCard: ({
    sourceDocument,
    errorCode,
  }: {
    sourceDocument: { id: string };
    errorCode?: string | null;
  }) => (
    <div data-testid={`card-${sourceDocument.id}`} data-error-code={errorCode ?? ""}>
      {sourceDocument.id}
    </div>
  ),
}));

function card(
  id: string,
  overrides: Partial<SourceDocumentListItemDto> = {}
): SourceDocumentListItemDto {
  return {
    id,
    version: 1,
    ledgerId: "ledger-1",
    title: `Doc ${id}`,
    text: null,
    processingStatus: "processing",
    failureKind: null,
    failureMessage: null,
    documentDate: "2026-07-15",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    hasImages: false,
    supportedActions: [],
    canEdit: false,
    errorCode: null,
    ...overrides,
  };
}

function groupsOf(ids: string[]): UnifiedStreamGroup[] {
  return [
    {
      date: "2026-07-15",
      dateProvenance: "transaction",
      total: "0",
      unconvertedCount: 0,
      currencyTotals: {},
      items: ids.map((id) => ({
        sourceDocument: card(id),
        ledgerEntries: [],
        effectiveDate: "2026-07-15",
        dateProvenance: "transaction",
      })),
    },
  ];
}

function renderGroups(ids: string[]) {
  return render(
    <LedgerEntriesUnifiedGroups
      streamGroups={groupsOf(ids)}
      mainCurrency="CNY"
      onViewSourceDetail={vi.fn()}
      onDeleteSourceConfirm={vi.fn()}
      isSelectionMode={false}
      selectedIds={[]}
      onToggleSelection={vi.fn()}
    />
  );
}

function rerenderGroups(rerender: (ui: ReactElement) => void, ids: string[]) {
  rerender(
    <LedgerEntriesUnifiedGroups
      streamGroups={groupsOf(ids)}
      mainCurrency="CNY"
      onViewSourceDetail={vi.fn()}
      onDeleteSourceConfirm={vi.fn()}
      isSelectionMode={false}
      selectedIds={[]}
      onToggleSelection={vi.fn()}
    />
  );
}

describe("stream list motion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes enter, exit, move, and update diffs by stable ID", () => {
    const item = (id: string, date: string, revision: string) => ({ id, date, revision });
    const diff = computeStreamListMotionDiff(
      [item("a", "2026-07-15", "v1"), item("b", "2026-07-15", "v1"), item("c", "2026-07-14", "v1")],
      [item("b", "2026-07-15", "v2"), item("a", "2026-07-15", "v1"), item("d", "2026-07-13", "v1")]
    );

    expect([...diff.entering]).toEqual(["d"]);
    expect(diff.exiting).toEqual([{ id: "c", date: "2026-07-14", index: 2 }]);
    expect([...diff.moving].sort()).toEqual(["a", "b"]);
    expect([...diff.updated]).toEqual(["b"]);
  });

  it("passes the source-document failure code to the card", () => {
    const groups = groupsOf(["doc-1"]);
    groups[0]!.items[0]!.sourceDocument = card("doc-1", {
      processingStatus: "failed",
      errorCode: "processing_timeout",
    });

    render(
      <LedgerEntriesUnifiedGroups
        streamGroups={groups}
        mainCurrency="CNY"
        onViewSourceDetail={vi.fn()}
        onDeleteSourceConfirm={vi.fn()}
        isSelectionMode={false}
        selectedIds={[]}
        onToggleSelection={vi.fn()}
      />
    );

    expect(screen.getByTestId("card-doc-1")).toHaveAttribute(
      "data-error-code",
      "processing_timeout"
    );
  });

  it("removes cards without inserting a flashing exit placeholder", () => {
    const { rerender } = renderGroups(["doc-1", "doc-2"]);
    rerenderGroups(rerender, ["doc-1"]);

    expect(document.querySelector('[data-stream-exit-card="doc-2"]')).toBeNull();
    expect(screen.getByTestId("card-doc-1")).toBeInTheDocument();
  });

  it("skips all animation states under reduced motion", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    const { rerender } = renderGroups(["doc-1"]);
    rerenderGroups(rerender, ["doc-1", "doc-2"]);

    expect(document.querySelector('[data-stream-card-id="doc-2"]')).not.toHaveClass(
      "stream-card-enter"
    );

    rerenderGroups(rerender, ["doc-1"]);
    expect(document.querySelector('[data-stream-exit-card="doc-2"]')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId("card-doc-1")).toBeInTheDocument();
  });
});
