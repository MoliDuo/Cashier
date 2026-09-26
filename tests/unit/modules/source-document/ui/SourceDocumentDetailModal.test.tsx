import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commonCopy } from "@/copy/common";
import { sourceDocumentActionCopy, sourceDocumentDetailCopy } from "@/copy/source-document";
import { queryKeys } from "@/lib/query-keys";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import type { SourceDocument } from "@/modules/source-document/contracts";
import { SourceDocumentDetailModal } from "@/modules/source-document/ui/SourceDocumentDetailModal";

const {
  toastErrorMock,
  fetchDetailMock,
  saveMock,
  splitMock,
  createEntryMock,
  deleteMock,
  cancelMock,
} = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  fetchDetailMock: vi.fn(),
  saveMock: vi.fn(),
  splitMock: vi.fn(),
  createEntryMock: vi.fn(),
  deleteMock: vi.fn(),
  cancelMock: vi.fn(),
}));

vi.mock("@/modules/source-document/queries", () => ({
  fetchSourceDocumentDetail: fetchDetailMock,
}));
vi.mock("@/modules/source-document/hooks/useLedgerRefreshPolling", () => ({
  useLedgerRefreshPolling: () => undefined,
}));
vi.mock("@/modules/ledger/queries", () => ({ fetchBook: vi.fn() }));
vi.mock("@/modules/source-document/server-actions/update", () => ({
  saveSourceDocumentChangesAction: saveMock,
}));
vi.mock("@/modules/source-document/server-actions/split", () => ({
  splitSourceDocumentAction: splitMock,
}));
vi.mock("@/modules/source-document/server-actions/delete", () => ({
  deleteSourceDocumentAction: deleteMock,
}));
vi.mock("@/modules/source-document/server-actions/processing", () => ({
  cancelSourceDocumentProcessingAction: cancelMock,
}));
vi.mock("@/modules/source-document/server-actions/book", () => ({
  assignSourceDocumentBookAction: vi.fn(),
}));
vi.mock("@/modules/source-document/server-actions/date-organization", () => ({
  applyDateOrganizationAction: vi.fn(),
  dismissDateOrganizationAction: vi.fn(),
}));
vi.mock("@/modules/ledger/server-actions/entries", () => ({
  createLedgerEntryAction: createEntryMock,
  deleteLedgerEntryAction: vi.fn(),
  batchUpdateLedgerEntriesAction: vi.fn(),
  batchDeleteLedgerEntriesAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastErrorMock, warning: vi.fn() },
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
        {/* The real dialog keeps itself open when its action throws. */}
        <button onClick={() => void Promise.resolve((onSave ?? onConfirm)?.()).catch(() => {})}>
          confirm-save
        </button>
        <button onClick={() => void Promise.resolve((onDiscard ?? onConfirm)?.()).catch(() => {})}>
          confirm-discard
        </button>
        <button onClick={() => onOpenChange?.(false)}>confirm-cancel</button>
      </div>
    ) : null,
}));

vi.mock("@/modules/ledger/hooks/useLedgerId", () => ({ useLedgerId: () => "ledger-1" }));

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
  ledgerEntries: [entry],
  updatedAt: "2026-07-28T00:00:00.000Z",
  supportedActions: [],
  canEdit: true,
  errorCode: null,
};

const detailKey = queryKeys.sourceDocument("doc-1");
/** The save button's label while one field of the draft differs from the server. */
const saveOneChange = sourceDocumentDetailCopy.saveChanges({ count: 1 });

function saved(version = 2) {
  return { ok: true, sourceDocumentId: "doc-1", version, data: { updatedEntryIds: [] } };
}

let client: QueryClient;

function newClient(document: SourceDocument | null = sourceDocument) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (document != null) client.setQueryData(queryKeys.sourceDocument(document.id), document);
  return client;
}

function modal(id = "doc-1", onClose: () => void = vi.fn()) {
  return (
    <QueryClientProvider client={client}>
      <SourceDocumentDetailModal
        books={[]}
        id={id}
        categories={[]}
        mainCurrency="CNY"
        preferredCurrencies={[]}
        open
        onClose={onClose}
      />
    </QueryClientProvider>
  );
}

function renderModal(
  document: SourceDocument | null = sourceDocument,
  onClose: () => void = vi.fn()
) {
  newClient(document);
  return render(modal("doc-1", onClose));
}

/** A newer server version arriving while the sheet is open. */
async function serverSends(document: SourceDocument | null) {
  await act(async () => {
    client.setQueryData(detailKey, document);
  });
}

function startEditing() {
  fireEvent.click(screen.getByText(commonCopy.edit));
  fireEvent.click(screen.getByText("change-draft"));
}

describe("SourceDocumentDetailModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    fetchDetailMock.mockResolvedValue(sourceDocument);
    saveMock.mockResolvedValue(saved());
  });

  it("loads the record it is opened on", async () => {
    newClient(null);
    render(modal());
    await waitFor(() => expect(screen.getByText("viewing")).toBeInTheDocument());
    expect(fetchDetailMock).toHaveBeenCalledExactlyOnceWith("doc-1");
  });

  it("does not let an earlier read overwrite a committed snapshot", async () => {
    let resolve!: (value: SourceDocument) => void;
    fetchDetailMock.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    newClient(null);
    render(modal());
    await waitFor(() => expect(fetchDetailMock).toHaveBeenCalled());
    await act(async () => {
      client.setQueryData(detailKey, { ...sourceDocument, version: 3, title: "Committed" });
      resolve({ ...sourceDocument, version: 2, title: "Old" });
    });
    await waitFor(() => expect(client.getQueryData(detailKey)).toMatchObject({ version: 3 }));
  });

  it("keeps the editor mounted when deletion refreshes its data to null", async () => {
    renderModal();
    startEditing();
    await serverSends(null);
    expect(screen.getByText(saveOneChange)).toBeInTheDocument();
  });

  it("clears committed edits before the refreshed server version arrives", async () => {
    let finish!: (value: SourceDocument) => void;
    fetchDetailMock.mockReturnValue(
      new Promise((done) => {
        finish = done;
      })
    );
    renderModal();
    startEditing();
    fireEvent.click(screen.getByText(saveOneChange));
    await waitFor(() => expect(screen.getByText("viewing")).toBeInTheDocument());
    await serverSends({ ...sourceDocument, title: "Changed", version: 2 });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => finish({ ...sourceDocument, title: "Changed", version: 2 }));
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("enters batch mode directly outside edit mode", () => {
    renderModal();
    fireEvent.click(screen.getByText("batch-toggle"));
    expect(screen.getByText("batch-toolbar")).toBeInTheDocument();
    expect(screen.getByText("selecting")).toBeInTheDocument();
    expect(screen.queryByText(commonCopy.edit)).not.toBeInTheDocument();
  });

  it("leaves an unchanged edit session before entering batch mode", () => {
    renderModal();
    fireEvent.click(screen.getByText(commonCopy.edit));
    expect(screen.getByText("editing")).toBeInTheDocument();
    fireEvent.click(screen.getByText("batch-toggle"));
    expect(screen.getByText("viewing")).toBeInTheDocument();
    expect(screen.getByText("batch-toolbar")).toBeInTheDocument();
  });

  it("saves a draft before entering batch mode", async () => {
    renderModal();
    startEditing();
    fireEvent.click(screen.getByText("batch-toggle"));
    expect(screen.getByText(sourceDocumentDetailCopy.batchModePendingTitle)).toBeInTheDocument();

    fireEvent.click(screen.getByText("confirm-save"));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("batch-toolbar")).toBeInTheDocument());
  });

  it("can discard a draft or cancel without changing modes", async () => {
    renderModal();
    startEditing();
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
    const { rerender } = renderModal();
    client.setQueryData(queryKeys.sourceDocument("doc-2"), {
      ...sourceDocument,
      id: "doc-2",
      title: "Second receipt",
      version: 2,
    });
    startEditing();
    expect(screen.getByText("editing")).toBeInTheDocument();

    rerender(modal("doc-2"));

    expect(screen.getByText("viewing")).toBeInTheDocument();
    expect(screen.queryByText(sourceDocumentDetailCopy.unsavedChanges)).not.toBeInTheDocument();
  });

  it("reports a real conflict only on save and reloads after confirmed cancellation", async () => {
    fetchDetailMock.mockResolvedValue({ ...sourceDocument, version: 2 });
    renderModal();
    startEditing();
    await serverSends({ ...sourceDocument, version: 2 });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(saveOneChange)).toBeEnabled();
    fireEvent.click(screen.getByText(saveOneChange));
    expect(toastErrorMock).toHaveBeenCalledWith(sourceDocumentDetailCopy.saveConflict);
    fireEvent.click(screen.getByText(sourceDocumentDetailCopy.cancelEdit));
    expect(fetchDetailMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("confirm-discard"));

    await waitFor(() => expect(fetchDetailMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("keeps edits when cancellation is declined", async () => {
    renderModal();
    startEditing();
    await serverSends({ ...sourceDocument, version: 2 });

    fireEvent.click(screen.getByText(sourceDocumentDetailCopy.cancelEdit));
    fireEvent.click(screen.getByText("confirm-cancel"));
    expect(fetchDetailMock).not.toHaveBeenCalled();
    expect(screen.getByText("editing")).toBeInTheDocument();
    expect(screen.getByText(saveOneChange)).toBeEnabled();
  });

  it("saves pending changes before continuing to another action", async () => {
    renderModal();
    startEditing();
    fireEvent.click(screen.getByText("add-entry"));

    expect(screen.getByText(sourceDocumentDetailCopy.saveBeforeActionTitle)).toBeInTheDocument();
    expect(screen.queryByText("add-entry-dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("confirm-save"));

    await waitFor(() => expect(saveMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText("add-entry-dialog")).toBeInTheDocument());
  });

  it("keeps the draft and deferred action blocked when save rejects", async () => {
    saveMock.mockRejectedValue(new Error("unavailable"));
    renderModal();
    startEditing();
    fireEvent.click(screen.getByText("add-entry"));
    fireEvent.click(screen.getByText("confirm-save"));

    await waitFor(() => expect(saveMock).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(sourceDocumentDetailCopy.saveAllFailed)
    );
    expect(screen.getByText(sourceDocumentDetailCopy.saveBeforeActionTitle)).toBeInTheDocument();
    expect(screen.getByText("editing")).toBeInTheDocument();
    expect(screen.queryByText("add-entry-dialog")).not.toBeInTheDocument();
    expect(createEntryMock).not.toHaveBeenCalled();
  });

  it("names a save the server refused as stale a conflict", async () => {
    saveMock.mockResolvedValue({
      ok: false,
      reason: "stale",
      sourceDocumentId: "doc-1",
      expectedVersion: 1,
      currentVersion: 2,
    });
    renderModal();
    startEditing();
    fireEvent.click(screen.getByText(saveOneChange));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(sourceDocumentDetailCopy.saveConflict)
    );
    expect(screen.getByText("editing")).toBeInTheDocument();
  });

  it("closes a deferred confirmation when the server version changes", async () => {
    renderModal();
    startEditing();
    fireEvent.click(screen.getByText("add-entry"));
    expect(screen.getByText(sourceDocumentDetailCopy.saveBeforeActionTitle)).toBeInTheDocument();

    await serverSends({ ...sourceDocument, version: 2 });
    expect(
      screen.queryByText(sourceDocumentDetailCopy.saveBeforeActionTitle)
    ).not.toBeInTheDocument();
    expect(screen.queryByText("add-entry-dialog")).not.toBeInTheDocument();
  });

  it("closes at once and restores the unsaved edits on the next opening", () => {
    const onClose = vi.fn();
    const first = renderModal(sourceDocument, onClose);
    startEditing();
    fireEvent.click(screen.getByText("dialog-close"));

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByText(sourceDocumentDetailCopy.unsavedChanges)).not.toBeInTheDocument();
    first.unmount();

    renderModal();
    expect(screen.getByText("editing")).toBeInTheDocument();
    expect(screen.getByText(commonCopy.draftRestored)).toBeInTheDocument();
    expect(screen.getByText(saveOneChange)).toBeEnabled();
  });

  it("flags a draft made on an older version and refuses to save it", () => {
    const first = renderModal();
    startEditing();
    first.unmount();

    renderModal({ ...sourceDocument, version: 2 });
    expect(screen.getByText(commonCopy.draftOutdated)).toBeInTheDocument();
    fireEvent.click(screen.getByText(saveOneChange));
    expect(toastErrorMock).toHaveBeenCalledWith(sourceDocumentDetailCopy.saveConflict);
    expect(saveMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(commonCopy.discard));
    expect(screen.getByText("viewing")).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
  });

  it("closes without asking while a date suggestion is being adjusted", () => {
    const onClose = vi.fn();
    renderModal(sourceDocument, onClose);
    fireEvent.click(screen.getByText("begin-date-adjustment"));
    fireEvent.click(screen.getByText("change-date-draft"));
    fireEvent.click(screen.getByText("dialog-close"));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("retries a failed save against the same base version", async () => {
    saveMock.mockRejectedValueOnce(new Error("temporary failure"));
    renderModal();
    startEditing();

    fireEvent.click(screen.getByText(saveOneChange));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(saveOneChange)).toBeEnabled());
    fireEvent.click(screen.getByText(saveOneChange));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2));

    expect(saveMock.mock.calls[0]![0]).toEqual({
      sourceDocumentId: "doc-1",
      expectedVersion: 1,
      sourceDocument: { title: "Changed" },
      entries: [],
    });
    expect(saveMock.mock.calls[1]![0]).toEqual(saveMock.mock.calls[0]![0]);
  });

  it("sends the latest draft values when a save is retried", async () => {
    saveMock.mockRejectedValue(new Error("temporary failure"));
    renderModal();
    startEditing();

    fireEvent.click(screen.getByText(saveOneChange));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("change-draft-again")).toBeEnabled());
    fireEvent.click(screen.getByText("change-draft-again"));
    fireEvent.click(screen.getByText(saveOneChange));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2));

    expect(saveMock.mock.calls[1]![0]).toMatchObject({
      sourceDocument: { title: "Changed again" },
    });
  });

  it("retries split with only the selected entries and date, then installs the snapshot", async () => {
    splitMock.mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce({
      splitSourceDocumentId: "doc-2",
      splitVersion: 1,
      movedEntryCount: 1,
      sourceDocument: { ...sourceDocument, version: 2, ledgerEntries: [secondEntry] },
    });
    renderModal({
      ...sourceDocument,
      supportedActions: ["split_entries"],
      ledgerEntries: [entry, secondEntry],
    });
    fireEvent.click(screen.getByText("batch-toggle"));
    fireEvent.click(screen.getByText("select-first"));
    fireEvent.click(screen.getByText("open-split"));

    fireEvent.click(screen.getByText("submit-split"));
    await waitFor(() => expect(splitMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("submit-split")).toBeInTheDocument());
    fireEvent.click(screen.getByText("submit-split"));
    await waitFor(() => expect(splitMock).toHaveBeenCalledTimes(2));

    const firstInput = splitMock.mock.calls[0]![0];
    expect(firstInput).toEqual({
      sourceDocumentId: "doc-1",
      ledgerEntryIds: ["entry-1"],
      entryDate: "2026-09-03",
    });
    expect(splitMock.mock.calls[1]![0]).toEqual(firstInput);
    await waitFor(() => expect(screen.queryByText("submit-split")).not.toBeInTheDocument());
    expect(client.getQueryData(detailKey)).toMatchObject({
      version: 2,
      ledgerEntries: [{ id: "entry-2" }],
    });
  });

  it("shows a pending indicator while processing is cancelled", async () => {
    cancelMock.mockReturnValue(new Promise(() => {}));
    renderModal({ ...sourceDocument, supportedActions: ["cancel_processing"] });

    fireEvent.click(screen.getByText(sourceDocumentActionCopy.cancelProcessing).closest("button")!);

    const cancel = screen.getByText(sourceDocumentActionCopy.cancelProcessing).closest("button");
    await waitFor(() => expect(cancel).toHaveAttribute("aria-busy", "true"));
    expect(cancel?.querySelector("svg")).toHaveClass("animate-spin");
    expect(cancelMock).toHaveBeenCalledWith("doc-1");
  });

  it("keeps the sheet open when deleting the record fails", async () => {
    deleteMock.mockRejectedValue(new Error("Source document not found"));
    const onClose = vi.fn();
    renderModal({ ...sourceDocument, supportedActions: ["delete"] }, onClose);

    fireEvent.click(screen.getByRole("button", { name: commonCopy.delete }));
    fireEvent.click(screen.getByText("confirm-save"));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith(commonCopy.deleteFailed));
    expect(deleteMock).toHaveBeenCalledWith("doc-1");
    expect(onClose).not.toHaveBeenCalled();
  });
});
