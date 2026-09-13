import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import type { SourceDocument } from "@/modules/source-document/contracts";
import { SourceDocumentCard } from "@/modules/source-document/ui/SourceDocumentCard";

vi.mock("@/modules/currency/ui/AmountDisplay", () => ({
  AmountDisplay: () => <span>CNY 12.00</span>,
}));

vi.mock("@/modules/currency/ui/amount-text", () => ({
  AmountText: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const sourceDocument: SourceDocument = {
  id: "doc-1",
  version: 1,
  ledgerId: "ledger-1",
  title: "Receipt",
  text: "Lunch",
  files: [],
  processingStatus: "completed",
  failureKind: null,
  failureMessage: null,
  documentDate: "2026-07-28",
  metadata: {},
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  deletedAt: null,
  hasImages: false,
  supportedActions: ["retry", "edit_retry", "delete"],
  canEdit: true,
  errorCode: null,
};

const ledgerEntry: LedgerEntry = {
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

describe("SourceDocumentCard interactions", () => {
  it("shows the total for completed direct revisions without an entry-source badge", () => {
    render(
      <SourceDocumentCard
        sourceDocument={{ ...sourceDocument, processingStatus: null }}
        ledgerEntries={[ledgerEntry]}
        processingStatus={null}
        defaultExpanded={false}
      />
    );

    expect(screen.getByText(/12\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/快速记账|Quick Entry/i)).not.toBeInTheDocument();
  });

  it("labels an unparsable document without echoing its AI reason in the badge", () => {
    render(
      <SourceDocumentCard
        sourceDocument={{
          ...sourceDocument,
          processingStatus: "failed",
          failureKind: "invalid_input",
          failureMessage: "这是一张退款单据，本系统只处理支出。",
        }}
        ledgerEntries={[]}
        processingStatus="failed"
        failureKind="invalid_input"
        errorCode={null}
        defaultExpanded={false}
      />
    );

    expect(screen.getByTestId("status-label")).toHaveTextContent("无法解析");
    expect(screen.queryByText("这是一张退款单据，本系统只处理支出。")).not.toBeInTheDocument();
  });

  it("starts expanded by default and opens details only from the main region", () => {
    const onViewDetails = vi.fn();
    render(
      <SourceDocumentCard
        sourceDocument={sourceDocument}
        ledgerEntries={[ledgerEntry]}
        processingStatus="completed"
        onViewDetails={onViewDetails}
      />
    );

    expect(screen.getByTestId("source-document-card-body")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Receipt/i }));
    expect(onViewDetails).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("source-document-card-root"));
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  it("runs the entry rows edge to edge in the card, the way the detail sheet does", () => {
    // Regression: the rows sat inside a padded list and were rounded, so each
    // one read as a small card of its own inside the card, with visible left
    // and right edges and a rule that stopped short of them.
    render(
      <SourceDocumentCard
        sourceDocument={sourceDocument}
        ledgerEntries={[ledgerEntry]}
        processingStatus="completed"
      />
    );

    const list = screen.getByTestId("source-document-card-body").firstElementChild as HTMLElement;
    const row = list.querySelector("button") as HTMLElement;
    expect(list).not.toHaveClass("px-3");
    expect(list).toHaveClass("divide-y");
    expect(row).toHaveClass("px-3");
    expect(row).not.toHaveClass("rounded-md");
  });

  it("supports a collapsed default and repeated expansion", async () => {
    render(
      <SourceDocumentCard
        sourceDocument={sourceDocument}
        ledgerEntries={[ledgerEntry]}
        processingStatus="completed"
        defaultExpanded={false}
      />
    );

    const toggle = screen.getByRole("button", { name: /展开|expand/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByTestId("source-document-card-body")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /折叠|collapse/i }));
    await waitFor(() =>
      expect(screen.queryByTestId("source-document-card-body")).not.toBeInTheDocument()
    );
  });

  it("opens an expanded ledger entry without opening the document", () => {
    const onViewDetails = vi.fn();
    const onViewLedgerEntry = vi.fn();
    render(
      <SourceDocumentCard
        sourceDocument={sourceDocument}
        ledgerEntries={[ledgerEntry]}
        processingStatus="completed"
        onViewDetails={onViewDetails}
        onViewLedgerEntry={onViewLedgerEntry}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Lunch/i }));
    expect(onViewLedgerEntry).toHaveBeenCalledWith(ledgerEntry);
    expect(onViewDetails).not.toHaveBeenCalled();
  });

  it("opens the actions menu without opening details", async () => {
    const user = userEvent.setup();
    const onViewDetails = vi.fn();
    render(
      <SourceDocumentCard
        sourceDocument={sourceDocument}
        ledgerEntries={[]}
        processingStatus="completed"
        onViewDetails={onViewDetails}
      />
    );

    await user.click(screen.getByRole("button", { name: /更多操作|more actions/i }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(onViewDetails).not.toHaveBeenCalled();
  });

  it("uses controlled recovery callbacks and pending state", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <SourceDocumentCard
        sourceDocument={{ ...sourceDocument, processingStatus: "failed" }}
        ledgerEntries={[]}
        processingStatus="failed"
        onRetry={onRetry}
        isRetrying
      />
    );

    await user.click(screen.getByRole("button", { name: /更多操作|more actions/i }));
    const retry = await screen.findByRole("menuitem", { name: /重新处理|重试|retry/i });
    expect(retry).toHaveAttribute("data-disabled");
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("does not open the actions menu when dragging the trigger outside the card", () => {
    render(
      <SourceDocumentCard
        sourceDocument={sourceDocument}
        ledgerEntries={[]}
        processingStatus="completed"
        onDelete={vi.fn()}
      />
    );

    const trigger = screen.getByRole("button", { name: /更多操作|more actions/i });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1, clientY: 10 });
    fireEvent.pointerUp(document, { button: 0, pointerId: 1, clientY: 100 });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the non-modal actions menu with Escape and restores trigger focus", async () => {
    const user = userEvent.setup();
    render(
      <SourceDocumentCard
        sourceDocument={sourceDocument}
        ledgerEntries={[]}
        processingStatus="completed"
        onDelete={vi.fn()}
      />
    );
    const trigger = screen.getByRole("button", { name: /更多操作|more actions/i });
    await user.click(trigger);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    await user.click(document.body);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("uses one full-card selection control and preserves expansion state", async () => {
    const user = userEvent.setup();
    const onViewDetails = vi.fn();
    const onToggleSelect = vi.fn();
    const { rerender } = render(
      <SourceDocumentCard
        sourceDocument={sourceDocument}
        ledgerEntries={[ledgerEntry]}
        processingStatus="completed"
        onViewDetails={onViewDetails}
        selectionMode
        onToggleSelect={onToggleSelect}
      />
    );

    expect(screen.getByTestId("source-document-card-body")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    const selectionControl = screen.getByRole("checkbox", { name: /Receipt/ });
    await user.click(selectionControl);
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onViewDetails).not.toHaveBeenCalled();
    const expand = screen.getAllByRole("button", { name: /折叠|collapse/i });
    expect(expand).toHaveLength(1);
    expect(expand[0]).toHaveAttribute(
      "aria-controls",
      screen.getByTestId("source-document-card-body").id
    );
    await user.click(expand[0]!);
    expect(screen.queryByTestId("source-document-card-body")).not.toBeInTheDocument();
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /展开|expand/i }));

    rerender(
      <SourceDocumentCard
        sourceDocument={sourceDocument}
        ledgerEntries={[ledgerEntry]}
        processingStatus="completed"
        onViewDetails={onViewDetails}
      />
    );
    expect(screen.getByTestId("source-document-card-body")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /折叠|collapse/i }));
    await waitFor(() =>
      expect(screen.queryByTestId("source-document-card-body")).not.toBeInTheDocument()
    );
  });

  it.each(["processing", "failed"] as const)(
    "shows the localized untitled fallback while %s",
    (status) => {
      render(
        <SourceDocumentCard
          sourceDocument={{ ...sourceDocument, title: null }}
          ledgerEntries={[]}
          processingStatus={status}
        />
      );

      expect(screen.getByText(/Untitled Bill|未命名账单/i)).toBeInTheDocument();
    }
  );

  it("never renders original voucher text or images on list cards", () => {
    render(
      <SourceDocumentCard
        sourceDocument={{
          ...sourceDocument,
          processingStatus: "processing",
          text: "Lunch at the canteen",
          files: [{ id: "file-1", contentType: "image/png", byteSize: 10, originalFilename: null }],
        }}
        ledgerEntries={[]}
        processingStatus="processing"
      />
    );

    expect(screen.queryByText(/Lunch at the canteen/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("paints the card by the document's state instead of printing it", () => {
    // Regression: every state used to print a status pill. The card now carries
    // the state itself — green and working, red and failed, grey and inert.
    const tones = [
      { status: "processing" as const, expected: ["bg-primary/5", "border-primary/25"] },
      { status: "failed" as const, expected: ["bg-danger/5", "border-danger/20"] },
      { status: "cancelled" as const, expected: ["bg-surface2", "border-border"] },
      { status: "completed" as const, expected: ["bg-surface", "border-border"] },
    ];

    for (const { status, expected } of tones) {
      const { unmount } = render(
        <SourceDocumentCard
          sourceDocument={{ ...sourceDocument, processingStatus: status }}
          ledgerEntries={[]}
          processingStatus={status}
        />
      );
      const card = screen.getByTestId("source-document-card-root");
      for (const className of expected) expect(card).toHaveClass(className);
      unmount();
    }
  });

  it("sweeps a band of light across a card only while its document is processing", () => {
    const { unmount } = render(
      <SourceDocumentCard
        sourceDocument={{ ...sourceDocument, processingStatus: "processing" }}
        ledgerEntries={[]}
        processingStatus="processing"
      />
    );
    const sweep = screen.getByTestId("source-document-processing-sweep");
    expect(sweep).toHaveClass("source-document-processing-sweep");
    // The band is decoration: the state itself stays in the live region.
    expect(sweep).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("status")).toHaveTextContent(/处理中|Processing/i);
    unmount();

    for (const status of ["completed", "cancelled"] as const) {
      const { unmount: unmountOther } = render(
        <SourceDocumentCard
          sourceDocument={{ ...sourceDocument, processingStatus: status }}
          ledgerEntries={[]}
          processingStatus={status}
        />
      );
      expect(screen.queryByTestId("source-document-processing-sweep")).not.toBeInTheDocument();
      // No words either: the surface is the whole message.
      expect(screen.queryByTestId("status-label")).not.toBeInTheDocument();
      unmountOther();
    }
  });

  it("still shows the total of a document that is being processed again", () => {
    // A retry keeps the previous result on screen; the card keeps its number.
    render(
      <SourceDocumentCard
        sourceDocument={{ ...sourceDocument, processingStatus: "processing" }}
        ledgerEntries={[ledgerEntry]}
        processingStatus="processing"
        defaultExpanded={false}
      />
    );

    expect(screen.getByText(/12\.00/)).toBeInTheDocument();
  });

  it("hides the expansion toggle when the card has no expandable entries", () => {
    render(
      <SourceDocumentCard
        sourceDocument={{ ...sourceDocument, processingStatus: "cancelled" }}
        ledgerEntries={[]}
        processingStatus="cancelled"
      />
    );

    expect(
      screen.queryByRole("button", { name: /展开|expand|折叠|collapse/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("source-document-card-body")).not.toBeInTheDocument();
  });

  it("keeps the expansion toggle for completed cards with entries", () => {
    render(
      <SourceDocumentCard
        sourceDocument={sourceDocument}
        ledgerEntries={[ledgerEntry]}
        processingStatus="completed"
        defaultExpanded={false}
      />
    );

    expect(screen.getByRole("button", { name: /展开|expand/i })).toBeInTheDocument();
  });
});
