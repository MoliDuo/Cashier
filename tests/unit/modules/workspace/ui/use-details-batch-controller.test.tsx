import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDetailsBatchController } from "@/modules/workspace/ui/useDetailsBatchController";

const {
  batchDeleteLedgerEntriesActionMock,
  batchUpdateLedgerEntriesActionMock,
  batchUpdateLedgerEntryDatesActionMock,
  previewBatchLedgerEntryDateActionMock,
  beginCategoryAssignmentActionMock,
  appendCategoryAssignmentSelectionActionMock,
  commitCategoryAssignmentSelectionActionMock,
  reclassificationJobMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  batchDeleteLedgerEntriesActionMock: vi.fn(),
  batchUpdateLedgerEntriesActionMock: vi.fn(),
  batchUpdateLedgerEntryDatesActionMock: vi.fn(),
  previewBatchLedgerEntryDateActionMock: vi.fn(),
  beginCategoryAssignmentActionMock: vi.fn(),
  appendCategoryAssignmentSelectionActionMock: vi.fn(),
  commitCategoryAssignmentSelectionActionMock: vi.fn(),
  reclassificationJobMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock, warning: vi.fn() },
}));

vi.mock("@/modules/ledger/server-actions/entries", () => ({
  batchDeleteLedgerEntriesAction: batchDeleteLedgerEntriesActionMock,
  batchUpdateLedgerEntriesAction: batchUpdateLedgerEntriesActionMock,
  batchUpdateLedgerEntryDatesAction: batchUpdateLedgerEntryDatesActionMock,
  previewBatchLedgerEntryDateAction: previewBatchLedgerEntryDateActionMock,
}));

vi.mock("@/modules/ledger/server-actions/reclassification", () => ({
  beginCategoryAssignmentAction: beginCategoryAssignmentActionMock,
  appendCategoryAssignmentSelectionAction: appendCategoryAssignmentSelectionActionMock,
  commitCategoryAssignmentSelectionAction: commitCategoryAssignmentSelectionActionMock,
}));

vi.mock("@/lib/queries/ledger-query-client", () => ({
  getCategoryReclassificationJobAction: reclassificationJobMock,
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function entry(id: string, sourceDocumentId = "document-1") {
  return {
    id,
    ledgerId: "ledger-1",
    categoryId: null,
    sourceDocumentId,
    amount: "1",
    currency: "CNY",
    itemName: id,
    description: null,
    convertedAmount: "1",
    exchangeRate: "1",
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    deletedAt: null,
    sourceDocument: {
      id: sourceDocumentId,
      version: 1,
      ledgerId: "ledger-1",
      title: null,
      processingStatus: "completed" as const,
      documentDate: "2026-09-04",
      createdAt: "2026-09-04T00:00:00.000Z",
      updatedAt: "2026-09-04T00:00:00.000Z",
    },
  };
}

function assignmentJob(status: "pending" | "running" | "succeeded" = "pending") {
  return {
    id: "job-1",
    formatVersion: 2,
    mode: { kind: "ai" as const, candidateCategoryIds: ["category-1", "category-2"] },
    status,
    total: 1,
    processedCount: status === "succeeded" ? 1 : 0,
    appliedCount: status === "succeeded" ? 1 : 0,
    confirmedCount: 0,
    failedCount: 0,
    conflictCount: 0,
    skippedCount: 0,
    cancelledCount: 0,
    documentTotal: 1,
    documentCompleted: status === "succeeded" ? 1 : 0,
    activeDocumentCount: status === "running" ? 1 : 0,
    retryingDocumentCount: 0,
    nextRetryAt: null,
    candidateCategories: [],
    receivedCount: status === "pending" ? 1 : 0,
    errorCode: null,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    completedAt: status === "succeeded" ? "2026-09-04T00:00:01.000Z" : null,
    canRetryFailed: false,
    evidenceIncomplete: false,
  };
}

const dateImpact = (
  entryCount: number
): {
  selectedEntryCount: number;
  sourceDocumentCount: number;
  affectedEntryCount: number;
  sourceDocumentIds: string[];
} => ({
  selectedEntryCount: entryCount,
  sourceDocumentCount: entryCount === 0 ? 0 : 1,
  affectedEntryCount: entryCount,
  sourceDocumentIds: entryCount === 0 ? [] : ["document-1"],
});

const succeededJob = () => ({
  ...assignmentJob("running"),
  status: "succeeded" as const,
  processedCount: 1,
  appliedCount: 1,
  documentCompleted: 1,
  activeDocumentCount: 0,
  completedAt: "2026-09-04T00:00:01.000Z",
});

describe("useDetailsBatchController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reclassificationJobMock.mockResolvedValue(null);
    beginCategoryAssignmentActionMock.mockResolvedValue({
      ...assignmentJob("pending"),
      status: "preparing",
      receivedCount: 0,
    });
    appendCategoryAssignmentSelectionActionMock.mockResolvedValue({
      jobId: "job-1",
      received: 1,
      total: 1,
    });
    commitCategoryAssignmentSelectionActionMock.mockResolvedValue(assignmentJob());
  });

  it("closes delete confirmation and finishes before refresh settles", async () => {
    const { queryClient, wrapper } = setup();
    const refreshGate = deferred();
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(() => refreshGate.promise);
    batchDeleteLedgerEntriesActionMock.mockResolvedValueOnce({
      succeeded: [{ id: "entry-1", sourceDocumentId: "document-1", version: 2 }],
      stale: [],
      failed: [],
    });
    const { result } = renderHook(
      () => useDetailsBatchController("ledger-1", [entry("entry-1")], "fingerprint"),
      { wrapper }
    );

    act(() => {
      result.current.handleSelect("entry-1", true);
      result.current.setDeleteDialogOpen(true);
    });
    let mutation!: Promise<unknown>;
    act(() => {
      mutation = result.current.remove.mutateAsync();
    });

    await act(async () => Promise.resolve());
    expect(result.current.remove.isPending).toBe(false);
    expect(result.current.deleteDialogOpen).toBe(false);
    expect(result.current.selectedIds).toEqual([]);

    await act(async () => {
      refreshGate.resolve();
      await mutation;
    });
  });

  it("closes the date dialog and finishes before refresh settles", async () => {
    const { queryClient, wrapper } = setup();
    const refreshGate = deferred();
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(() => refreshGate.promise);
    batchUpdateLedgerEntryDatesActionMock.mockResolvedValueOnce({
      ok: true,
      versions: [{ sourceDocumentId: "document-1", version: 2 }],
      data: { impact: { affectedEntryCount: 1 } },
    });
    previewBatchLedgerEntryDateActionMock.mockResolvedValueOnce({
      selectedEntryCount: 1,
      sourceDocumentCount: 0,
      affectedEntryCount: 1,
      sourceDocumentIds: [],
    });
    const { result } = renderHook(
      () => useDetailsBatchController("ledger-1", [entry("entry-1")], "fingerprint"),
      { wrapper }
    );

    act(() => {
      result.current.handleSelect("entry-1", true);
    });
    act(() => result.current.openDateDialog());
    await act(async () => Promise.resolve());
    let mutation!: Promise<unknown>;
    act(() => {
      mutation = result.current.updateDates.mutateAsync();
    });

    await act(async () => Promise.resolve());
    expect(result.current.updateDates.isPending).toBe(false);
    expect(result.current.dateDialogOpen).toBe(false);
    expect(result.current.selectedIds).toEqual([]);

    await act(async () => {
      refreshGate.resolve();
      await mutation;
    });
  });

  it("clears selection and finishes the batch update before refresh", async () => {
    const { queryClient, wrapper } = setup();
    const refreshGate = deferred();
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(() => refreshGate.promise);
    batchUpdateLedgerEntriesActionMock.mockResolvedValueOnce({
      ok: true,
      versions: [{ sourceDocumentId: "document-1", version: 2 }],
      data: { ledgerEntryIds: ["entry-1"], affectedCount: 1 },
    });
    const { result } = renderHook(
      () => useDetailsBatchController("ledger-1", [entry("entry-1")], "fingerprint"),
      { wrapper }
    );

    act(() => result.current.handleSelect("entry-1", true));
    let mutation!: Promise<unknown>;
    act(() => {
      mutation = result.current.update.mutateAsync({ categoryId: "category-1" });
    });

    await act(async () => Promise.resolve());
    expect(result.current.update.isPending).toBe(false);
    expect(result.current.selectedIds).toEqual([]);

    await act(async () => {
      refreshGate.resolve();
      await mutation;
    });
  });

  it("confirms a date preview while its captured selection is unchanged", async () => {
    const { wrapper } = setup();
    previewBatchLedgerEntryDateActionMock.mockResolvedValueOnce({
      selectedEntryCount: 2,
      sourceDocumentCount: 1,
      affectedEntryCount: 2,
      sourceDocumentIds: ["document-1"],
    });
    batchUpdateLedgerEntryDatesActionMock.mockResolvedValueOnce({
      ok: true,
      versions: [{ sourceDocumentId: "document-1", version: 2 }],
      data: { impact: { affectedEntryCount: 2 } },
    });
    const { result } = renderHook(
      () =>
        useDetailsBatchController("ledger-1", [entry("entry-1"), entry("entry-2")], "fingerprint"),
      { wrapper }
    );

    act(() => {
      result.current.handleSelect("entry-1", true);
      result.current.handleSelect("entry-2", true);
    });
    act(() => result.current.openDateDialog());
    await act(async () => Promise.resolve());
    expect(previewBatchLedgerEntryDateActionMock).toHaveBeenCalledWith("ledger-1", [
      "entry-1",
      "entry-2",
    ]);

    await act(async () => {
      await result.current.updateDates.mutateAsync();
    });
    expect(batchUpdateLedgerEntryDatesActionMock).toHaveBeenCalledWith(
      "ledger-1",
      [{ sourceDocumentId: "document-1", expectedVersion: 1 }],
      ["entry-1", "entry-2"],
      result.current.selectedDate
    );
  });

  it("rejects confirmation when selection changes after date preview", async () => {
    const { wrapper } = setup();
    previewBatchLedgerEntryDateActionMock.mockResolvedValueOnce({
      selectedEntryCount: 2,
      sourceDocumentCount: 1,
      affectedEntryCount: 2,
      sourceDocumentIds: ["document-1"],
    });
    const { result } = renderHook(
      () =>
        useDetailsBatchController("ledger-1", [entry("entry-1"), entry("entry-2")], "fingerprint"),
      { wrapper }
    );

    act(() => {
      result.current.handleSelect("entry-1", true);
      result.current.handleSelect("entry-2", true);
    });
    act(() => result.current.openDateDialog());
    await act(async () => Promise.resolve());
    act(() => result.current.handleSelect("entry-2", false));

    await expect(result.current.updateDates.mutateAsync()).rejects.toThrow("selection_changed");
    expect(batchUpdateLedgerEntryDatesActionMock).not.toHaveBeenCalled();
  });

  it("keeps selection when an atomic batch update is stale", async () => {
    const { wrapper } = setup();
    batchUpdateLedgerEntriesActionMock.mockResolvedValueOnce({
      ok: false,
      reason: "stale",
      staleTargets: [{ sourceDocumentId: "document-1", expectedVersion: 1, currentVersion: 2 }],
    });
    const { result } = renderHook(
      () => useDetailsBatchController("ledger-1", [entry("entry-1")], "fingerprint"),
      { wrapper }
    );
    act(() => result.current.handleSelect("entry-1", true));

    await expect(
      result.current.update.mutateAsync({ categoryId: "category-1" })
    ).rejects.toMatchObject({ code: "SOURCE_DOCUMENT_STALE" });

    expect(result.current.selectedIds).toEqual(["entry-1"]);
    expect(toastErrorMock).toHaveBeenCalledWith("error");
  });

  it("keeps the date dialog and selection when confirmation is stale", async () => {
    const { wrapper } = setup();
    previewBatchLedgerEntryDateActionMock.mockResolvedValueOnce({
      selectedEntryCount: 1,
      sourceDocumentCount: 1,
      affectedEntryCount: 1,
      sourceDocumentIds: ["document-1"],
    });
    batchUpdateLedgerEntryDatesActionMock.mockResolvedValueOnce({
      ok: false,
      reason: "stale",
      staleTargets: [{ sourceDocumentId: "document-1", expectedVersion: 1, currentVersion: 2 }],
    });
    const { result } = renderHook(
      () => useDetailsBatchController("ledger-1", [entry("entry-1")], "fingerprint"),
      { wrapper }
    );
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.openDateDialog());
    await act(async () => Promise.resolve());

    await expect(result.current.updateDates.mutateAsync()).rejects.toMatchObject({
      code: "SOURCE_DOCUMENT_STALE",
    });

    expect(result.current.dateDialogOpen).toBe(true);
    expect(result.current.selectedIds).toEqual(["entry-1"]);
  });

  it("leaves the dialog open with the failure when the preview cannot be computed", async () => {
    const { wrapper } = setup();
    previewBatchLedgerEntryDateActionMock.mockRejectedValueOnce(new Error("preview down"));
    const { result } = renderHook(
      () => useDetailsBatchController("ledger-1", [entry("entry-1")], "fingerprint"),
      { wrapper }
    );
    act(() => {
      result.current.handleSelect("entry-1", true);
      result.current.openDateDialog();
    });
    await act(async () => Promise.resolve());

    expect(result.current.dateDialogOpen).toBe(true);
    expect(result.current.datePreviewFailed).toBe(true);
    expect(result.current.dateImpact).toBeNull();
  });

  it("starts an AI sort for the captured selection and clears it", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => useDetailsBatchController("ledger-1", [entry("entry-1")], "fingerprint"),
      { wrapper }
    );
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => {
      result.current.toggleCategoryPick("category-1", true);
      result.current.toggleCategoryPick("category-2", true);
    });

    await act(async () => result.current.confirmCategory());
    await act(async () => Promise.resolve());

    expect(beginCategoryAssignmentActionMock).toHaveBeenCalledWith("ledger-1", {
      requestKey: expect.any(String),
      mode: { kind: "ai", candidateCategoryIds: ["category-1", "category-2"] },
      expectedEntryCount: 1,
    });
    expect(appendCategoryAssignmentSelectionActionMock).toHaveBeenCalledWith("ledger-1", {
      jobId: "job-1",
      chunkIndex: 0,
      entries: [{ ledgerEntryId: "entry-1", sourceDocumentId: "document-1", expectedVersion: 1 }],
    });
    expect(commitCategoryAssignmentSelectionActionMock).toHaveBeenCalledWith("ledger-1", {
      jobId: "job-1",
      expectedEntryCount: 1,
    });
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.categoryDialogOpen).toBe(false);
    expect(toastSuccessMock).toHaveBeenCalledWith("aiCategoryRunning");
  });

  it("writes one picked category straight through instead of asking the model", async () => {
    const { wrapper } = setup();
    batchUpdateLedgerEntriesActionMock.mockResolvedValueOnce({
      ok: true,
      versions: [{ sourceDocumentId: "document-1", version: 2 }],
      data: { ledgerEntryIds: ["entry-1"], affectedCount: 1 },
    });
    const { result } = renderHook(
      () => useDetailsBatchController("ledger-1", [entry("entry-1")], "fingerprint"),
      { wrapper }
    );
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => result.current.toggleCategoryPick("category-1", true));

    await act(async () => result.current.confirmCategory());
    await act(async () => Promise.resolve());

    expect(batchUpdateLedgerEntriesActionMock).toHaveBeenCalledWith(
      "ledger-1",
      expect.anything(),
      ["entry-1"],
      { categoryId: "category-1" }
    );
    expect(beginCategoryAssignmentActionMock).not.toHaveBeenCalled();
    expect(result.current.categoryDialogOpen).toBe(false);
  });

  it("takes the clear row as an answer, and drops the categories it excluded", async () => {
    const { wrapper } = setup();
    batchUpdateLedgerEntriesActionMock.mockResolvedValueOnce({
      ok: true,
      versions: [{ sourceDocumentId: "document-1", version: 2 }],
      data: { ledgerEntryIds: ["entry-1"], affectedCount: 1 },
    });
    const { result } = renderHook(
      () => useDetailsBatchController("ledger-1", [entry("entry-1")], "fingerprint"),
      { wrapper }
    );
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => {
      result.current.toggleCategoryPick("category-1", true);
      result.current.toggleCategoryPick(null, true);
    });

    expect(result.current.pickedCategoryIds).toEqual([]);
    expect(result.current.clearCategoryPicked).toBe(true);

    await act(async () => result.current.confirmCategory());
    await act(async () => Promise.resolve());

    expect(batchUpdateLedgerEntriesActionMock).toHaveBeenCalledWith(
      "ledger-1",
      expect.anything(),
      ["entry-1"],
      { categoryId: null }
    );
    expect(beginCategoryAssignmentActionMock).not.toHaveBeenCalled();
  });

  it("refuses to start when the selection moved under the dialog", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () =>
        useDetailsBatchController("ledger-1", [entry("entry-1"), entry("entry-2")], "fingerprint"),
      { wrapper }
    );
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => result.current.toggleCategoryPick("category-1", true));
    // The dialog is still open but the selection behind it changed.
    act(() => result.current.handleSelect("entry-2", true));

    await act(async () => result.current.confirmCategory());

    expect(result.current.categorySelectionChanged).toBe(true);
    expect(beginCategoryAssignmentActionMock).not.toHaveBeenCalled();
    expect(batchUpdateLedgerEntriesActionMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("selectionMoved");
  });

  it("reports a finished run once, and only for a run this client watched", async () => {
    const { wrapper, queryClient } = setup();
    const running = assignmentJob("running");
    // A fresh object per poll, so every response really does reach the hook.
    reclassificationJobMock
      .mockResolvedValueOnce(running)
      .mockImplementation(async () => succeededJob());
    const { result } = renderHook(
      () => useDetailsBatchController("ledger-1", [entry("entry-1")], "fingerprint"),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isReclassifying).toBe(true));

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ["ledger", "ledger-1", "category-reclassification"],
      });
    });

    await waitFor(() => expect(result.current.isReclassifying).toBe(false));
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ["ledger", "ledger-1", "category-reclassification"],
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
  });

  it("stays quiet about a run that finished before this client arrived", async () => {
    const { wrapper } = setup();
    reclassificationJobMock.mockResolvedValue(succeededJob());
    const { result } = renderHook(
      () => useDetailsBatchController("ledger-1", [entry("entry-1")], "fingerprint"),
      { wrapper }
    );
    await waitFor(() => expect(result.current.reclassificationJob).not.toBeNull());
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("writes a single pick straight through at the direct limit", async () => {
    const { wrapper } = setup();
    const ids = Array.from({ length: 100 }, (_, index) => `entry-${index}`);
    batchUpdateLedgerEntriesActionMock.mockResolvedValueOnce({
      ok: true,
      versions: [{ sourceDocumentId: "document-1", version: 2 }],
      data: { ledgerEntryIds: ids, affectedCount: 100 },
    });
    const { result } = renderHook(
      () =>
        useDetailsBatchController(
          "ledger-1",
          ids.map((id) => entry(id)),
          "fingerprint"
        ),
      { wrapper }
    );
    act(() => result.current.handleSelectMany(ids, true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => result.current.toggleCategoryPick("category-1", true));

    await act(async () => {
      result.current.confirmCategory();
      await Promise.resolve();
    });

    expect(beginCategoryAssignmentActionMock).not.toHaveBeenCalled();
    expect(batchUpdateLedgerEntriesActionMock).toHaveBeenCalledTimes(1);
    expect(result.current.categoryDialogOpen).toBe(false);
  });

  it("asks the model once a single pick passes the direct limit", async () => {
    const { wrapper } = setup();
    const ids = Array.from({ length: 101 }, (_, index) => `entry-${index}`);
    const { result } = renderHook(
      () =>
        useDetailsBatchController(
          "ledger-1",
          ids.map((id) => entry(id)),
          "fingerprint"
        ),
      { wrapper }
    );
    act(() => result.current.handleSelectMany(ids, true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => result.current.toggleCategoryPick("category-1", true));

    await act(async () => {
      result.current.confirmCategory();
      await Promise.resolve();
    });

    expect(batchUpdateLedgerEntriesActionMock).not.toHaveBeenCalled();
    expect(beginCategoryAssignmentActionMock).toHaveBeenCalledWith("ledger-1", {
      requestKey: expect.any(String),
      mode: { kind: "assign", categoryId: "category-1" },
      expectedEntryCount: 101,
    });
  });

  it("uploads a long selection in 1000-entry chunks, resuming from what the server already has", async () => {
    const { wrapper } = setup();
    const ids = Array.from({ length: 2500 }, (_, index) => `entry-${index}`);
    beginCategoryAssignmentActionMock.mockResolvedValueOnce({
      ...assignmentJob("pending"),
      status: "preparing",
      receivedCount: 1000,
    });
    appendCategoryAssignmentSelectionActionMock.mockImplementation(
      async (_ledgerId: string, input: { chunkIndex: number }) => ({
        jobId: "job-1",
        received: Math.min(2500, 1000 + input.chunkIndex * 1000),
        total: 2500,
      })
    );
    const { result } = renderHook(
      () =>
        useDetailsBatchController(
          "ledger-1",
          ids.map((id) => entry(id)),
          "fingerprint"
        ),
      { wrapper }
    );
    act(() => result.current.handleSelectMany(ids, true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => result.current.toggleCategoryPick("category-1", true));

    await act(async () => {
      result.current.confirmCategory();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(commitCategoryAssignmentSelectionActionMock).toHaveBeenCalledWith("ledger-1", {
        jobId: "job-1",
        expectedEntryCount: 2500,
      })
    );

    const chunks = appendCategoryAssignmentSelectionActionMock.mock.calls.map((call) => ({
      chunkIndex: (call[1] as { chunkIndex: number }).chunkIndex,
      size: (call[1] as { entries: unknown[] }).entries.length,
    }));
    expect(chunks).toEqual([
      { chunkIndex: 1, size: 1000 },
      { chunkIndex: 2, size: 500 },
    ]);
  });

  it("keeps the picks when the direct write fails", async () => {
    const { wrapper } = setup();
    batchUpdateLedgerEntriesActionMock.mockRejectedValueOnce(new Error("write failed"));
    const { result } = renderHook(
      () => useDetailsBatchController("ledger-1", [entry("entry-1")], "fingerprint"),
      { wrapper }
    );
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => result.current.toggleCategoryPick("category-1", true));

    await act(async () => {
      result.current.confirmCategory();
      await Promise.resolve();
    });

    expect(result.current.categoryDialogOpen).toBe(true);
    expect(result.current.pickedCategoryIds).toEqual(["category-1"]);
    expect(beginCategoryAssignmentActionMock).not.toHaveBeenCalled();
  });

  it("keeps a run reporting after its dialog is closed", async () => {
    const { wrapper, queryClient } = setup();
    const running = assignmentJob("running");
    reclassificationJobMock.mockResolvedValueOnce(null).mockImplementation(async () => ({
      ...running,
    }));
    const { result } = renderHook(
      () => useDetailsBatchController("ledger-1", [entry("entry-1")], "fingerprint"),
      { wrapper }
    );
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => {
      result.current.toggleCategoryPick("category-1", true);
      result.current.toggleCategoryPick("category-2", true);
    });

    await act(async () => {
      result.current.confirmCategory();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.categoryDialogOpen).toBe(false));

    await waitFor(() => expect(result.current.isReclassifying).toBe(true));
    reclassificationJobMock.mockImplementation(async () => succeededJob());
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ["ledger", "ledger-1", "category-reclassification"],
      });
    });

    await waitFor(() => expect(result.current.isReclassifying).toBe(false));
    expect(toastSuccessMock).toHaveBeenCalledWith("aiCategoryDone");
  });

  it("ignores a date preview that lands after the dialog was reopened", async () => {
    const { wrapper } = setup();
    const firstPreview = deferred();
    previewBatchLedgerEntryDateActionMock
      .mockImplementationOnce(async () => {
        await firstPreview.promise;
        return dateImpact(2);
      })
      .mockResolvedValueOnce(dateImpact(1));
    const { result } = renderHook(
      () =>
        useDetailsBatchController("ledger-1", [entry("entry-1"), entry("entry-2")], "fingerprint"),
      { wrapper }
    );
    act(() => result.current.handleSelectMany(["entry-1", "entry-2"], true));
    act(() => result.current.openDateDialog());
    act(() => result.current.setDateDialogOpen(false));
    act(() => result.current.handleSelect("entry-2", false));
    act(() => result.current.openDateDialog());

    await waitFor(() => expect(result.current.dateImpact).toEqual(dateImpact(1)));
    await act(async () => {
      firstPreview.resolve();
      await Promise.resolve();
    });
    await act(async () => Promise.resolve());

    expect(result.current.dateImpact).toEqual(dateImpact(1));
    expect(result.current.dateSelectionChanged).toBe(false);
    expect(result.current.updateDates.isPending).toBe(false);
  });

  it("retries a failed date preview inside the open dialog", async () => {
    const { wrapper } = setup();
    previewBatchLedgerEntryDateActionMock
      .mockRejectedValueOnce(new Error("preview down"))
      .mockResolvedValueOnce(dateImpact(1));
    const { result } = renderHook(
      () => useDetailsBatchController("ledger-1", [entry("entry-1")], "fingerprint"),
      { wrapper }
    );
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.openDateDialog());
    await waitFor(() => expect(result.current.datePreviewFailed).toBe(true));
    expect(result.current.dateDialogOpen).toBe(true);

    act(() => result.current.retryDatePreview());

    await waitFor(() => expect(result.current.dateImpact).toEqual(dateImpact(1)));
    expect(result.current.datePreviewFailed).toBe(false);
  });

  it("refuses to confirm a preview once the filters moved under it", async () => {
    const { wrapper } = setup();
    previewBatchLedgerEntryDateActionMock.mockResolvedValueOnce(dateImpact(1));
    const { result, rerender } = renderHook(
      ({ fingerprint }: { fingerprint: string }) =>
        useDetailsBatchController("ledger-1", [entry("entry-1")], fingerprint),
      { wrapper, initialProps: { fingerprint: "fingerprint" } }
    );
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.openDateDialog());
    await waitFor(() => expect(result.current.dateImpact).toEqual(dateImpact(1)));

    rerender({ fingerprint: "other-fingerprint" });

    expect(result.current.dateSelectionChanged).toBe(true);
    await expect(result.current.updateDates.mutateAsync()).rejects.toThrow("selection_changed");
    expect(batchUpdateLedgerEntryDatesActionMock).not.toHaveBeenCalled();
  });
});
