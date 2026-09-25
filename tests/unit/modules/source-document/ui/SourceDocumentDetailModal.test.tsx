import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import type { SourceDocument } from "@/modules/source-document/contracts";
import { SourceDocumentDetailModal } from "@/modules/source-document/ui/SourceDocumentDetailModal";

const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastErrorMock },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    onOpenChange,
  }: {
    children?: ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div>
      {children}
      <button onClick={() => onOpenChange?.(false)}>dialog-close</button>
    </div>
  ),
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({
    open,
    title,
    onOpenChange,
    onConfirm,
    onSave,
    onDiscard,
  }: {
    open?: boolean;
    title: string;
    onOpenChange?: (open: boolean) => void;
    onConfirm?: () => void | Promise<void | boolean>;
    onSave?: () => void | Promise<void | boolean>;
    onDiscard?: () => void | Promise<void | boolean>;
  }) =>
    open ? (
      <div>
        <span>{title}</span>
        <button onClick={() => void (onSave ?? onConfirm)?.()}>confirm-save</button>
        <button onClick={() => void (onDiscard ?? onConfirm)?.()}>confirm-discard</button>
        <button onClick={() => onOpenChange?.(false)}>confirm-cancel</button>
      </div>
    ) : null,
}));

vi.mock("@/components/ui/editable-field", () => ({
  EditableField: () => null,
}));

vi.mock("@/modules/source-document/ui/SourceDocumentViewDetails", () => ({
  SourceDocumentViewDetails: ({
    isEditMode,
    isSelectionMode,
    onSourceDocChange,
    onToggleSelectionMode,
    onSelectEntry,
    onAddEntry,
    onDateAdjustmentStateChange,
    selectionToolbar,
  }: {
    isEditMode?: boolean;
    isSelectionMode: boolean;
    onSourceDocChange: (change: { title: string }) => void;
    onToggleSelectionMode: () => void;
    onSelectEntry: (entryId: string, selected: boolean) => void;
    onAddEntry?: () => void;
    onDateAdjustmentStateChange?: (active: boolean, dirty: boolean) => void;
    selectionToolbar?: ReactNode;
  }) => (
    <div>
      {/* The real pane renders the band in the entries card's header row. */}
      {selectionToolbar}
      <span>{isEditMode ? "editing" : "viewing"}</span>
      <span>{isSelectionMode ? "selecting" : "not-selecting"}</span>
      <button disabled={!isEditMode} onClick={() => onSourceDocChange({ title: "Changed" })}>
        change-draft
      </button>
      <button disabled={!isEditMode} onClick={() => onSourceDocChange({ title: "Changed again" })}>
        change-draft-again
      </button>
      <button onClick={onToggleSelectionMode}>batch-toggle</button>
      <button onClick={() => onSelectEntry("entry-1", true)}>select-first</button>
      <button onClick={onAddEntry}>add-entry</button>
      <button onClick={() => onDateAdjustmentStateChange?.(true, false)}>
        begin-date-adjustment
      </button>
      <button onClick={() => onDateAdjustmentStateChange?.(true, true)}>change-date-draft</button>
    </div>
  ),
}));

vi.mock("@/modules/ledger/ui/batch-action-toolbar", () => ({
  LedgerEntriesBatchActionToolbar: ({ onSplit }: { onSplit?: () => void }) => (
    <div>
      batch-toolbar
      {onSplit != null ? <button onClick={onSplit}>open-split</button> : null}
    </div>
  ),
}));

vi.mock("@/modules/source-document/ui/SourceDocumentEditRetryDialog", () => ({
  SourceDocumentEditRetryDialog: () => null,
}));
vi.mock("@/modules/source-document/ui/AddLedgerEntryDialog", () => ({
  AddLedgerEntryDialog: ({ open }: { open: boolean }) =>
    open ? <div>add-entry-dialog</div> : null,
}));
vi.mock("@/modules/source-document/ui/SourceDocumentSplitDialog", () => ({
  SourceDocumentSplitDialog: ({
    open,
    onSubmit,
  }: {
    open: boolean;
    onSubmit: (documentDate: string) => Promise<void>;
  }) => (open ? <button onClick={() => void onSubmit("2026-09-03")}>submit-split</button> : null),
}));
vi.mock("@/modules/source-document/ui/use-diagnostic-messages", () => ({
  useDiagnosticMessages: () => ({ label: vi.fn(), description: vi.fn() }),
}));
vi.mock("@/lib/navigation/ledger-detail-navigation", () => ({
  openLedgerDetail: vi.fn(),
}));

const entry: LedgerEntry = {
  id: "entry-1",
  ledgerId: "ledger-1",
  sourceDocumentId: "doc-1",
  categoryId: null,
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

const secondEntry: LedgerEntry = {
  ...entry,
  id: "entry-2",
  itemName: "Dinner",
  amount: "18.00",
  convertedAmount: "18.00",
};

const sourceDocument: SourceDocument = {
  id: "doc-1",
  version: 1,
  ledgerId: "ledger-1",
  title: "Receipt",
  text: null,
  files: [],
  processingStatus: "completed",
  failureKind: null,
  failureMessage: null,
  documentDate: "2026-07-28",
  createdAt: "2026-07-28T00:00:00.000Z",
  hasImages: false,
  ledgerEntries: [],
  updatedAt: "2026-07-28T00:00:00.000Z",
  supportedActions: [],
  canEdit: true,
  errorCode: null,
};

function modal(
  onSaveAll = vi.fn(async () => undefined),
  document: SourceDocument | null = sourceDocument,
  overrides: {
    sourceDocumentId?: string;
    ledgerEntries?: LedgerEntry[];
    onClose?: () => void;
    onReload?: () => Promise<void>;
    onSplit?: React.ComponentProps<typeof SourceDocumentDetailModal>["onSplit"];
    onAddEntry?: React.ComponentProps<typeof SourceDocumentDetailModal>["onAddEntry"];
    onCancelProcessing?: React.ComponentProps<
      typeof SourceDocumentDetailModal
    >["onCancelProcessing"];
    isCancelling?: boolean;
  } = {}
) {
  return (
    <SourceDocumentDetailModal
      {...(overrides.sourceDocumentId != null
        ? { sourceDocumentId: overrides.sourceDocumentId }
        : {})}
      sourceDocument={document}
      ledgerEntries={overrides.ledgerEntries ?? [entry]}
      categories={[]}
      mainCurrency="CNY"
      preferredCurrencies={[]}
      open
      onClose={overrides.onClose ?? vi.fn()}
      {...(overrides.onReload !== undefined ? { onReload: overrides.onReload } : {})}
      onSaveAll={onSaveAll}
      {...(overrides.onSplit !== undefined ? { onSplit: overrides.onSplit } : {})}
      {...(overrides.onAddEntry !== undefined ? { onAddEntry: overrides.onAddEntry } : {})}
      {...(overrides.onCancelProcessing !== undefined
        ? { onCancelProcessing: overrides.onCancelProcessing }
        : {})}
      {...(overrides.isCancelling !== undefined ? { isCancelling: overrides.isCancelling } : {})}
      onBatchUpdate={vi.fn(async () => ({ affectedCount: 1 }))}
      onBatchDeleteEntries={vi.fn(async () => ({ succeeded: [], failed: [] }))}
    />
  );
}

function renderModal(onSaveAll = vi.fn(async () => undefined)) {
  return { onSaveAll, ...render(modal(onSaveAll)) };
}

describe("SourceDocumentDetailModal batch mode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the editor mounted when deletion refreshes its data to null", () => {
    const save = vi.fn(async () => undefined);
    const { rerender } = render(modal(save, sourceDocument, { sourceDocumentId: "doc-1" }));
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByText("change-draft"));
    rerender(modal(save, null, { sourceDocumentId: "doc-1" }));
    expect(screen.getByText("saveChanges")).toBeInTheDocument();
  });

  it("clears committed edits before the refreshed server version arrives", async () => {
    let finish!: () => void;
    const onSaveAll = vi.fn().mockImplementation((_input, onCommitted: () => void) => {
      onCommitted();
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const { rerender } = renderModal(onSaveAll);
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByText("change-draft"));
    fireEvent.click(screen.getByText("saveChanges"));
    expect(screen.getByText("viewing")).toBeInTheDocument();
    rerender(modal(onSaveAll, { ...sourceDocument, title: "Changed", version: 2 }));
    expect(screen.queryByText("revisionConflict")).not.toBeInTheDocument();
    await act(async () => finish());
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("enters batch mode directly outside edit mode", () => {
    renderModal();
    fireEvent.click(screen.getByText("batch-toggle"));
    expect(screen.getByText("batch-toolbar")).toBeInTheDocument();
    expect(screen.getByText("selecting")).toBeInTheDocument();
    expect(screen.queryByText("edit")).not.toBeInTheDocument();
  });

  it("leaves an unchanged edit session before entering batch mode", () => {
    renderModal();
    fireEvent.click(screen.getByText("edit"));
    expect(screen.getByText("editing")).toBeInTheDocument();
    fireEvent.click(screen.getByText("batch-toggle"));
    expect(screen.getByText("viewing")).toBeInTheDocument();
    expect(screen.getByText("batch-toolbar")).toBeInTheDocument();
  });

  it("saves a draft before entering batch mode", async () => {
    const { onSaveAll } = renderModal();
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByText("change-draft"));
    fireEvent.click(screen.getByText("batch-toggle"));
    expect(screen.getByText("batchModePendingTitle")).toBeInTheDocument();

    fireEvent.click(screen.getByText("confirm-save"));
    await waitFor(() => expect(onSaveAll).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("batch-toolbar")).toBeInTheDocument());
  });

  it("can discard a draft or cancel without changing modes", async () => {
    renderModal();
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByText("change-draft"));
    fireEvent.click(screen.getByText("batch-toggle"));
    fireEvent.click(screen.getByText("confirm-cancel"));
    expect(screen.getByText("editing")).toBeInTheDocument();
    expect(screen.queryByText("batch-toolbar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("batch-toggle"));
    fireEvent.click(screen.getByText("confirm-discard"));
    await waitFor(() => expect(screen.getByText("batch-toolbar")).toBeInTheDocument());
    expect(screen.getByText("viewing")).toBeInTheDocument();
  });

  it("resets editor state when the selected source document changes", () => {
    const onSaveAll = vi.fn(async () => undefined);
    const { rerender } = renderModal(onSaveAll);
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByText("change-draft"));
    expect(screen.getByText("editing")).toBeInTheDocument();

    rerender(
      modal(onSaveAll, {
        ...sourceDocument,
        id: "doc-2",
        title: "Second receipt",
        version: 2,
      })
    );

    expect(screen.getByText("viewing")).toBeInTheDocument();
    expect(screen.queryByText("unsavedChanges")).not.toBeInTheDocument();
  });

  it("reports a real conflict only on save and reloads after confirmed cancellation", async () => {
    const onSaveAll = vi.fn(async () => undefined);
    const onReload = vi.fn(async () => undefined);
    const { rerender } = render(modal(onSaveAll, sourceDocument, { onReload }));
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByText("change-draft"));

    rerender(modal(onSaveAll, { ...sourceDocument, version: 2 }, { onReload }));

    expect(screen.queryByText("reloadServerData")).not.toBeInTheDocument();
    expect(screen.getByText("saveChanges")).toBeEnabled();
    fireEvent.click(screen.getByText("saveChanges"));
    expect(toastErrorMock).toHaveBeenCalledWith("saveConflict");
    fireEvent.click(screen.getByText("cancelEdit"));
    expect(onReload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("confirm-discard"));

    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(onSaveAll).not.toHaveBeenCalled();
  });

  it("keeps edits when cancellation is declined", async () => {
    const onReload = vi.fn(async () => {
      throw new Error("reload failed");
    });
    const { rerender } = render(modal(undefined, sourceDocument, { onReload }));
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByText("change-draft"));
    rerender(modal(undefined, { ...sourceDocument, version: 2 }, { onReload }));

    fireEvent.click(screen.getByText("cancelEdit"));
    fireEvent.click(screen.getByText("confirm-cancel"));
    expect(onReload).not.toHaveBeenCalled();
    expect(screen.getByText("editing")).toBeInTheDocument();
    expect(screen.getByText("saveChanges")).toBeEnabled();
  });

  it("saves pending changes before continuing to another action", async () => {
    const onSaveAll = vi.fn(async () => undefined);
    render(modal(onSaveAll, sourceDocument, { onAddEntry: vi.fn(async () => undefined) }));
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByText("change-draft"));
    fireEvent.click(screen.getByText("add-entry"));

    expect(screen.getByText("saveBeforeActionTitle")).toBeInTheDocument();
    expect(screen.queryByText("add-entry-dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("confirm-save"));

    await waitFor(() => expect(onSaveAll).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText("add-entry-dialog")).toBeInTheDocument());
  });

  it("keeps the draft and deferred action blocked when save rejects", async () => {
    const onSaveAll = vi.fn().mockRejectedValue(new Error("stale"));
    const onAddEntry = vi.fn(async () => undefined);
    render(modal(onSaveAll, sourceDocument, { onAddEntry }));
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByText("change-draft"));
    fireEvent.click(screen.getByText("add-entry"));
    fireEvent.click(screen.getByText("confirm-save"));

    await waitFor(() => expect(onSaveAll).toHaveBeenCalledOnce());
    expect(screen.getByText("saveBeforeActionTitle")).toBeInTheDocument();
    expect(screen.getByText("editing")).toBeInTheDocument();
    expect(screen.queryByText("add-entry-dialog")).not.toBeInTheDocument();
    expect(onAddEntry).not.toHaveBeenCalled();
  });

  it("closes a deferred confirmation when the server version changes", async () => {
    const rendered = render(
      modal(undefined, sourceDocument, { onAddEntry: vi.fn(async () => undefined) })
    );
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByText("change-draft"));
    fireEvent.click(screen.getByText("add-entry"));
    expect(screen.getByText("saveBeforeActionTitle")).toBeInTheDocument();

    rendered.rerender(modal(undefined, { ...sourceDocument, version: 2 }, { onAddEntry: vi.fn() }));
    expect(screen.queryByText("saveBeforeActionTitle")).not.toBeInTheDocument();
    expect(screen.queryByText("add-entry-dialog")).not.toBeInTheDocument();
  });

  it("requires confirmation before closing with unsaved changes", () => {
    const onClose = vi.fn();
    render(modal(undefined, sourceDocument, { onClose }));
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByText("change-draft"));
    fireEvent.click(screen.getByText("dialog-close"));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("unsavedChanges")).toBeInTheDocument();
    fireEvent.click(screen.getByText("confirm-discard"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("requires confirmation before closing with an adjusted date suggestion draft", () => {
    const onClose = vi.fn();
    render(modal(undefined, sourceDocument, { onClose }));
    fireEvent.click(screen.getByText("begin-date-adjustment"));
    fireEvent.click(screen.getByText("change-date-draft"));
    fireEvent.click(screen.getByText("dialog-close"));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("unsavedChanges")).toBeInTheDocument();
    fireEvent.click(screen.getByText("confirm-discard"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("retries a failed save against the same base version", async () => {
    const onSaveAll = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);
    renderModal(onSaveAll);
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByText("change-draft"));

    fireEvent.click(screen.getByText("saveChanges"));
    await waitFor(() => expect(onSaveAll).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("saveChanges"));
    await waitFor(() => expect(onSaveAll).toHaveBeenCalledTimes(2));

    expect(onSaveAll.mock.calls[0]![0].expectedVersion).toBe(1);
    expect(onSaveAll.mock.calls[1]![0].expectedVersion).toBe(1);
    expect(onSaveAll.mock.calls[0]![0]).not.toHaveProperty("operationId");
  });

  it("sends changed draft values without browser operation identity", async () => {
    const onSaveAll = vi.fn().mockRejectedValue(new Error("temporary failure"));
    renderModal(onSaveAll);
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByText("change-draft"));

    fireEvent.click(screen.getByText("saveChanges"));
    await waitFor(() => expect(onSaveAll).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("change-draft-again"));
    fireEvent.click(screen.getByText("saveChanges"));
    await waitFor(() => expect(onSaveAll).toHaveBeenCalledTimes(2));

    expect(onSaveAll.mock.calls[1]![0]).toMatchObject({
      changes: { sourceDoc: { title: "Changed again" } },
    });
    expect(onSaveAll.mock.calls[1]![0]).not.toHaveProperty("operationId");
  });

  it("retries split with only the selected entries and date", async () => {
    const onSplit = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        splitSourceDocumentId: "doc-2",
        splitVersion: 1,
        movedEntryCount: 1,
      });
    render(
      modal(
        undefined,
        { ...sourceDocument, supportedActions: ["split_entries"] },
        { ledgerEntries: [entry, secondEntry], onSplit }
      )
    );
    fireEvent.click(screen.getByText("batch-toggle"));
    fireEvent.click(screen.getByText("select-first"));
    fireEvent.click(screen.getByText("open-split"));

    fireEvent.click(screen.getByText("submit-split"));
    await waitFor(() => expect(onSplit).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("submit-split"));
    await waitFor(() => expect(onSplit).toHaveBeenCalledTimes(2));

    const firstInput = onSplit.mock.calls[0]![0];
    const secondInput = onSplit.mock.calls[1]![0];
    expect(firstInput).toEqual({
      ledgerEntryIds: ["entry-1"],
      entryDate: "2026-09-03",
    });
    expect(secondInput).toEqual(firstInput);
    expect(secondInput).not.toHaveProperty("operationId");
    expect(secondInput).not.toHaveProperty("newSourceDocumentId");
    await waitFor(() => expect(screen.queryByText("submit-split")).not.toBeInTheDocument());
  });

  it("shows a pending indicator for cancellation", () => {
    render(
      modal(
        undefined,
        {
          ...sourceDocument,
          supportedActions: ["cancel_processing"],
        },
        {
          onCancelProcessing: vi.fn(async () => undefined),
          isCancelling: true,
        }
      )
    );

    const cancel = screen.getByText("cancelProcessing").closest("button");
    expect(cancel).toHaveAttribute("aria-busy", "true");
    expect(cancel?.querySelector("svg")).toHaveClass("animate-spin");
  });
});
