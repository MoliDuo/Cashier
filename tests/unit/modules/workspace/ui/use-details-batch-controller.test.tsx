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
    await act(async () => {
      await result.current.previewDate.mutateAsync();
    });
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
    await act(async () => result.current.previewDate.mutateAsync());
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
    reclassificationJobMock.mockResolvedValueOnce(running).mockResolvedValue({
      ...running,
      status: "succeeded",
      processedCount: 1,
      appliedCount: 1,
      documentCompleted: 1,
      activeDocumentCount: 0,
      completedAt: "2026-09-04T00:00:01.000Z",
    });
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
    expect(toastSuccessMock).toHaveBeenCalledWith("aiCategoryDone");
  });
});
