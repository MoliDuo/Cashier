import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { expectAmountVariant, expectTextRole } from "tests/helpers/class-tables";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import type { SourceDocument } from "@/modules/source-document/contracts";
import { SourceDocumentViewDetails } from "@/modules/source-document/ui/SourceDocumentViewDetails";

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    unoptimized: _unoptimized,
    alt,
    ...props
  }: React.ComponentProps<"img"> & {
    fill?: boolean;
    unoptimized?: boolean;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} alt={alt ?? ""} />
  ),
}));

vi.mock("@/modules/source-document/ui/SourceDocumentImageModal", () => ({
  SourceDocumentImageModal: ({
    open,
    initialIndex,
    images,
  }: {
    open: boolean;
    initialIndex: number;
    images: Array<{ storedFileId?: string }>;
  }) => (
    <div
      data-testid="image-viewer-state"
      data-open={open}
      data-index={initialIndex}
      data-file-ids={images.map((image) => image.storedFileId).join(",")}
    />
  ),
}));

vi.mock("@/modules/source-document/ui/EditableLedgerEntryItem", () => ({
  EditableLedgerEntryItem: ({
    ledgerEntry,
    pendingChanges,
  }: {
    ledgerEntry: LedgerEntry;
    pendingChanges?: { itemName?: string };
  }) => (
    <input
      aria-label="Entry name"
      value={pendingChanges?.itemName ?? ledgerEntry.itemName}
      readOnly
    />
  ),
}));

function documentWithFiles(count: number): SourceDocument {
  return {
    id: "doc-1",
    version: 1,
    ledgerId: "ledger-1",
    title: "Receipt",
    text: null,
    files: Array.from({ length: count }, (_, index) => ({
      id: `file-${index + 1}`,
      contentType: "image/png",
      byteSize: 100,
      originalFilename: `${index + 1}.png`,
    })),
    processingStatus: "completed",
    failureKind: null,
    failureMessage: null,
    documentDate: "2026-07-28",
    metadata: {},
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    deletedAt: null,
    supportedActions: [],
    canEdit: true,
    errorCode: null,
  };
}

function renderWithQueryClient(element: ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
}

function renderDetails(count: number, isLoadingImages = false) {
  const sourceDocument = documentWithFiles(count);
  return renderWithQueryClient(
    <SourceDocumentViewDetails
      sourceDocument={sourceDocument}
      ledgerEntries={[]}
      categories={[]}
      pendingChanges={{ sourceDoc: {}, entries: {} }}
      selectedEntryIds={[]}
      isSelectionMode={false}
      isLoadingImages={isLoadingImages}
      mobileView="details"
      onMobileViewChange={vi.fn()}
      onSourceDocChange={vi.fn()}
      onEntryChange={vi.fn()}
      onSelectEntry={vi.fn()}
      onToggleSelectionMode={vi.fn()}
      interactionDisabled
    />
  );
}

describe("SourceDocumentViewDetails summary date", () => {
  it("shows the transaction date as plain text outside edit mode", () => {
    renderDetails(0);

    const dateRow = screen.getByTestId("source-document-date-row");
    expect(dateRow).toHaveTextContent(/2026年7月28日|Jul 28, 2026/);
    expect(within(dateRow).queryByRole("button")).not.toBeInTheDocument();
  });

  it("previews the transaction date and the total in the toolbar", () => {
    renderDetails(0);

    const dateRow = screen.getByTestId("source-document-date-row");
    // The bar reuses the ledger toolbar shell: select control, centred date, total.
    expect(within(dateRow).getByText("交易时间")).toHaveClass("sr-only");
    const date = within(dateRow).getByText(/2026年7月28日|Jul 28, 2026/);
    expectTextRole(date, "bodyStrong");
    expectAmountVariant(within(dateRow).getByText("¥0.00"), "item");
    // The read-only date drops its calendar marker.
    expect(dateRow.querySelector(".lucide-calendar")).not.toBeInTheDocument();

    // The entry count no longer takes a row of its own.
    expect(screen.queryByText("明细项目 (0)")).not.toBeInTheDocument();
    expect(screen.queryByText("=")).not.toBeInTheDocument();
    expect(screen.queryByText(/创建于/)).not.toBeInTheDocument();
  });

  it("restores the date picker in edit mode", () => {
    renderWithQueryClient(
      <SourceDocumentViewDetails
        sourceDocument={documentWithFiles(0)}
        ledgerEntries={[]}
        categories={[]}
        pendingChanges={{ sourceDoc: {}, entries: {} }}
        selectedEntryIds={[]}
        isSelectionMode={false}
        isEditMode
        mobileView="details"
        onMobileViewChange={vi.fn()}
        onSourceDocChange={vi.fn()}
        onEntryChange={vi.fn()}
        onSelectEntry={vi.fn()}
        onToggleSelectionMode={vi.fn()}
      />
    );

    const dateRow = screen.getByTestId("source-document-date-row");
    expect(within(dateRow).getAllByRole("button").length).toBeGreaterThan(0);
  });
});

describe("SourceDocumentViewDetails image stage", () => {
  it("shows an evidence empty state without hiding the details pane", () => {
    renderDetails(0);
    expect(screen.getByText(/暂无原始凭证|No original evidence/i)).toBeInTheDocument();
    expect(screen.getByTestId("source-document-details-pane")).not.toHaveClass("hidden");
    expect(
      screen.queryByRole("button", { name: /back to details|返回明细/i })
    ).not.toBeInTheDocument();
  });

  it("shows the image skeleton instead of the empty state while evidence is loading", () => {
    renderDetails(0, true);
    expect(screen.getByTestId("source-document-image-stage-loading")).toBeInTheDocument();
    expect(screen.queryByText(/暂无原始凭证|No original evidence/i)).not.toBeInTheDocument();
  });

  it("uses the same stable stage geometry while images are loading", () => {
    renderDetails(1, true);
    expect(screen.getByTestId("source-document-image-stage-loading")).toHaveClass("aspect-[4/3]");
    expect(screen.queryByTestId("source-document-image-stage")).not.toBeInTheDocument();
  });

  it("uses the authenticated stored-file route and hides thumbnails for one image", () => {
    renderDetails(1);
    const stage = screen.getByTestId("source-document-image-stage");
    expect(stage).toHaveClass("aspect-[4/3]");
    expect(stage.querySelector("img")).toHaveAttribute("src", "/api/stored-files/file-1");
    expect(stage.querySelector("img")).not.toHaveAttribute("src", expect.stringContaining("blob:"));
    expect(screen.getAllByRole("button", { name: /图片 1|image 1/i })).toHaveLength(1);
    expect(screen.getByTestId("image-viewer-state")).toHaveAttribute("data-file-ids", "file-1");
  });

  it("switches thumbnails independently and opens the viewer at the active index", () => {
    renderDetails(2);
    fireEvent.click(screen.getByRole("button", { name: /图片 2|image 2/i }));
    expect(screen.getByTestId("source-document-image-stage")).toHaveAccessibleName(
      /图片 2|image 2/i
    );
    fireEvent.click(screen.getByTestId("source-document-image-stage"));
    expect(screen.getByTestId("image-viewer-state")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("image-viewer-state")).toHaveAttribute("data-index", "1");
    expect(screen.getByTestId("image-viewer-state")).toHaveAttribute(
      "data-file-ids",
      "file-1,file-2"
    );
  });

  it("hides the details pane and returns from evidence through the controlled view", () => {
    // The pane toggle is driven by the footer, so this component only reports
    // the requested view back to its owner.
    const onMobileViewChange = vi.fn();
    renderWithQueryClient(
      <SourceDocumentViewDetails
        sourceDocument={documentWithFiles(1)}
        ledgerEntries={[]}
        categories={[]}
        pendingChanges={{ sourceDoc: {}, entries: {} }}
        selectedEntryIds={[]}
        isSelectionMode={false}
        mobileView="evidence"
        onMobileViewChange={onMobileViewChange}
        onSourceDocChange={vi.fn()}
        onEntryChange={vi.fn()}
        onSelectEntry={vi.fn()}
        onToggleSelectionMode={vi.fn()}
      />
    );

    expect(screen.getByTestId("source-document-details-pane")).toHaveClass("hidden", "lg:block");

    fireEvent.click(screen.getByRole("button", { name: /back to details|返回明细/i }));
    expect(onMobileViewChange).toHaveBeenCalledWith("details");
  });
});

describe("SourceDocumentViewDetails selection", () => {
  it("shows the batch selection entry outside edit mode", () => {
    const entry: LedgerEntry = {
      id: "entry-1",
      ledgerId: "ledger-1",
      categoryId: null,
      sourceDocumentId: "doc-1",
      amount: "12.00",
      currency: "CNY",
      itemName: "Lunch",
      description: null,
      convertedAmount: "12.00",
      exchangeRate: "1",
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
      deletedAt: null,
    };
    const onToggleSelectionMode = vi.fn();

    renderWithQueryClient(
      <SourceDocumentViewDetails
        sourceDocument={documentWithFiles(0)}
        ledgerEntries={[entry]}
        categories={[]}
        pendingChanges={{ sourceDoc: {}, entries: {} }}
        selectedEntryIds={[]}
        isSelectionMode={false}
        isEditMode={false}
        mobileView="details"
        onMobileViewChange={vi.fn()}
        onSourceDocChange={vi.fn()}
        onEntryChange={vi.fn()}
        onSelectEntry={vi.fn()}
        onToggleSelectionMode={onToggleSelectionMode}
      />
    );

    fireEvent.click(screen.getByTitle(/select|选择/i));
    expect(onToggleSelectionMode).toHaveBeenCalledTimes(1);
  });

  it("freezes the editable card and keeps pending changes when selection mode exits", () => {
    const entry: LedgerEntry = {
      id: "entry-1",
      ledgerId: "ledger-1",
      categoryId: null,
      sourceDocumentId: "doc-1",
      amount: "12.00",
      currency: "CNY",
      itemName: "Lunch",
      description: null,
      convertedAmount: "12.00",
      exchangeRate: "1",
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
      deletedAt: null,
    };
    const pendingChanges = {
      sourceDoc: {},
      entries: { "entry-1": { itemName: "Edited lunch" } },
    };
    const onSelectEntry = vi.fn();
    const commonProps = {
      sourceDocument: documentWithFiles(0),
      ledgerEntries: [entry],
      categories: [],
      pendingChanges,
      selectedEntryIds: [],
      mobileView: "details" as const,
      onMobileViewChange: vi.fn(),
      onSourceDocChange: vi.fn(),
      onEntryChange: vi.fn(),
      onSelectEntry,
      onToggleSelectionMode: vi.fn(),
    };
    const queryClient = new QueryClient();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <SourceDocumentViewDetails {...commonProps} isSelectionMode />
      </QueryClientProvider>
    );

    const input = screen.getByDisplayValue("Edited lunch");
    expect(input.closest("[inert]")).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", { name: /Lunch/i });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(checkbox);
    expect(onSelectEntry).toHaveBeenCalledTimes(1);
    expect(onSelectEntry).toHaveBeenCalledWith("entry-1", true);

    rerender(
      <QueryClientProvider client={queryClient}>
        <SourceDocumentViewDetails {...commonProps} isSelectionMode={false} />
      </QueryClientProvider>
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Edited lunch").closest("[inert]")).toBeNull();
  });
});

describe("SourceDocumentViewDetails entry row outline", () => {
  const entry = (id: string, itemName: string): LedgerEntry => ({
    id,
    ledgerId: "ledger-1",
    categoryId: null,
    sourceDocumentId: "doc-1",
    amount: "12.00",
    currency: "CNY",
    itemName,
    description: null,
    convertedAmount: "12.00",
    exchangeRate: "1",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    deletedAt: null,
  });

  function renderSelection(ledgerEntries: LedgerEntry[], selectedEntryIds: string[]) {
    return renderWithQueryClient(
      <SourceDocumentViewDetails
        sourceDocument={documentWithFiles(0)}
        ledgerEntries={ledgerEntries}
        categories={[]}
        pendingChanges={{ sourceDoc: {}, entries: {} }}
        selectedEntryIds={selectedEntryIds}
        isSelectionMode
        mobileView="details"
        onMobileViewChange={vi.fn()}
        onSourceDocChange={vi.fn()}
        onEntryChange={vi.fn()}
        onSelectEntry={vi.fn()}
        onToggleSelectionMode={vi.fn()}
      />
    );
  }

  it("does not clip a selected entry's outline down to its top and bottom edges", () => {
    // Regression: the entries card clipped its rows, and the outline is drawn
    // one pixel outside the row — on the card's own border — so a selected row
    // lost both verticals and read as two stray strips above and below it.
    const { container } = renderSelection([entry("entry-1", "Lunch")], ["entry-1"]);

    const card = screen.getByTestId("source-document-date-row").parentElement as HTMLElement;
    expect(card).not.toHaveClass("overflow-hidden");
    expect(
      container.querySelector('[data-selection-mode="true"][data-selected="true"]')
    ).toHaveClass("ring-1", "ring-primary");
  });
});
