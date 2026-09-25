import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBatchSourceDocumentActions } from "@/modules/source-document/hooks/useBatchSourceDocumentActions";

const {
  deleteSourceDocumentActionMock,
  batchUpdateSourceDocumentsActionMock,
  toastSuccessMock,
  toastErrorMock,
  toastWarningMock,
} = vi.hoisted(() => ({
  deleteSourceDocumentActionMock: vi.fn(),
  batchUpdateSourceDocumentsActionMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastWarningMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock, warning: toastWarningMock },
}));

vi.mock("@/modules/source-document/server-actions/processing", () => ({
  cancelSourceDocumentProcessingAction: vi.fn(),
}));
vi.mock("@/modules/source-document/server-actions/update", () => ({
  batchUpdateSourceDocumentsAction: batchUpdateSourceDocumentsActionMock,
}));
vi.mock("@/modules/source-document/server-actions/batch", () => ({
  batchDeleteSourceDocumentsAction: vi.fn(),
  batchRetrySourceDocumentsAction: vi.fn(),
}));
vi.mock("@/modules/source-document/server-actions/delete", () => ({
  deleteSourceDocumentAction: deleteSourceDocumentActionMock,
}));

function createWrapper(
  queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
) {
  return function ToastFeedbackTestWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("source document mutation toast ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports list deletion success and failure exactly once", async () => {
    const clearSelection = vi.fn();
    const { result } = renderHook(() => useBatchSourceDocumentActions(clearSelection, undefined), {
      wrapper: createWrapper(),
    });

    deleteSourceDocumentActionMock.mockResolvedValueOnce({
      sourceDocumentId: "document-1",
      deleted: true,
    });
    await act(async () => {
      await result.current.deleteSourceDocument.mutateAsync("document-1");
    });

    expect(toastSuccessMock).toHaveBeenCalledWith("deleteSuccess");
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    expect(clearSelection).toHaveBeenCalledTimes(1);

    deleteSourceDocumentActionMock.mockRejectedValueOnce(new Error("delete failed"));
    await act(async () => {
      await expect(result.current.deleteSourceDocument.mutateAsync("document-2")).rejects.toThrow(
        "delete failed"
      );
    });

    expect(toastErrorMock).toHaveBeenCalledWith("deleteFailed");
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });

  it("applies deletion feedback and finishes before refresh settles", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    const refreshGate = deferred();
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(() => refreshGate.promise);
    deleteSourceDocumentActionMock.mockResolvedValueOnce({
      sourceDocumentId: "document-1",
      deleted: true,
    });
    const clearSelection = vi.fn();
    const { result } = renderHook(() => useBatchSourceDocumentActions(clearSelection, undefined), {
      wrapper: createWrapper(queryClient),
    });

    let mutation!: Promise<void>;
    const onCommitted = vi.fn();
    act(() => {
      mutation = result.current.deleteSourceDocument.mutateAsync({ id: "document-1", onCommitted });
    });

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith("deleteSuccess"));
    expect(result.current.deleteSourceDocument.isPending).toBe(false);
    expect(onCommitted).toHaveBeenCalledOnce();
    expect(onCommitted.mock.invocationCallOrder[0]).toBeLessThan(
      toastSuccessMock.mock.invocationCallOrder[0]!
    );
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(toastWarningMock).not.toHaveBeenCalled();

    await act(async () => {
      refreshGate.resolve();
      await mutation;
    });
  });

  it("reports refresh failures separately from mutation error feedback", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(queryClient, "invalidateQueries").mockRejectedValue(new Error("offline"));
    deleteSourceDocumentActionMock.mockResolvedValueOnce({
      sourceDocumentId: "document-1",
      deleted: true,
    });
    const { result } = renderHook(() => useBatchSourceDocumentActions(vi.fn(), undefined), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.deleteSourceDocument.mutateAsync("document-1");
    });

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledTimes(1));
    expect(toastWarningMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("deleteSuccess");
    expect(toastErrorMock).toHaveBeenCalledWith("savedRefreshFailed");
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });

  it("does not clear selection or show success when a batch date update fails", async () => {
    batchUpdateSourceDocumentsActionMock.mockRejectedValueOnce(new Error("not found"));
    const clearSelection = vi.fn();
    const { result } = renderHook(() => useBatchSourceDocumentActions(clearSelection, undefined), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.batchUpdateDates.mutateAsync({
        ids: ["document-1"],
        entryDate: "2026-09-04",
      })
    ).rejects.toThrow("not found");

    expect(batchUpdateSourceDocumentsActionMock).toHaveBeenCalledWith({
      sourceDocumentIds: ["document-1"],
      data: { documentDate: "2026-09-04" },
    });
    expect(clearSelection).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("error");
  });
});
