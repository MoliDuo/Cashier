import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSourceDocumentDetailData } from "@/modules/source-document/hooks/useSourceDocumentDetailData";
import { queryKeys } from "@/lib/query-keys";

const getSourceDocumentDetailAction = vi.fn();

vi.mock("@/modules/source-document/queries", () => ({
  fetchSourceDocumentDetail: (...args: unknown[]) => getSourceDocumentDetailAction(...args),
}));

describe("useSourceDocumentDetailData", () => {
  it("does not let an earlier read overwrite a committed split snapshot", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const key = queryKeys.sourceDocument("source-1");
    let resolve!: (value: unknown) => void;
    getSourceDocumentDetailAction.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const { result } = renderHook(
      () => useSourceDocumentDetailData({ id: "source-1", open: true }),
      { wrapper }
    );
    await waitFor(() => expect(getSourceDocumentDetailAction).toHaveBeenCalled());
    await act(async () => {
      queryClient.setQueryData(key, {
        id: "source-1",
        version: 3,
        title: "Committed",
        ledgerEntries: [],
      });
      resolve({ id: "source-1", version: 2, title: "Old", ledgerEntries: [] });
    });
    await waitFor(() => expect(result.current.sourceDocument?.title).toBe("Committed"));
    expect(queryClient.getQueryData(key)).toMatchObject({ version: 3 });
  });
  beforeEach(() => {
    getSourceDocumentDetailAction.mockReset().mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Lunch",
      text: "receipt",
      files: [],
      processingStatus: "completed",
      failureMessage: null,
      documentDate: "2026-07-15",
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      ledgerEntries: [],
      hasImages: false,
      supportedActions: ["retry", "edit_retry", "delete"],
      errorCode: null,
    });
  });

  it("loads a detail through one bounded action request", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useSourceDocumentDetailData({
          id: "11111111-1111-4111-8111-111111111111",
          open: true,
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.sourceDocument?.title).toBe("Lunch"));
    expect(getSourceDocumentDetailAction).toHaveBeenCalledTimes(1);
    expect(getSourceDocumentDetailAction).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111"
    );
  });

  it("shows fresh cached data immediately without refetching on every open", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    queryClient.setQueryData(queryKeys.sourceDocument("11111111-1111-4111-8111-111111111111"), {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Cached",
      text: "receipt",
      files: [],
      processingStatus: "completed",
      failureMessage: null,
      documentDate: "2026-07-28",
      createdAt: "2026-07-15T00:00:00.000Z",
      ledgerEntries: [],
      hasImages: false,
      supportedActions: [],
      errorCode: null,
      latestSubmissionRevisionId: null,
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useSourceDocumentDetailData({
          id: "11111111-1111-4111-8111-111111111111",
          open: true,
        }),
      { wrapper }
    );

    expect(result.current.sourceDocument?.documentDate).toBe("2026-07-28");
    expect(getSourceDocumentDetailAction).not.toHaveBeenCalled();
  });

  it("shows stale cached data immediately and refreshes it in the background", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    queryClient.setQueryData(
      queryKeys.sourceDocument("11111111-1111-4111-8111-111111111111"),
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Cached",
        text: "receipt",
        files: [],
        processingStatus: "completed",
        failureMessage: null,
        documentDate: "2026-07-28",
        createdAt: "2026-07-15T00:00:00.000Z",
        ledgerEntries: [],
        hasImages: false,
        supportedActions: [],
        errorCode: null,
        latestSubmissionRevisionId: null,
      },
      { updatedAt: Date.now() - 2 * 60 * 1000 - 1 }
    );
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useSourceDocumentDetailData({
          id: "11111111-1111-4111-8111-111111111111",
          open: true,
        }),
      { wrapper }
    );

    expect(result.current.sourceDocument?.title).toBe("Cached");
    await waitFor(() => expect(getSourceDocumentDetailAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.sourceDocument?.title).toBe("Lunch"));
  });
});
