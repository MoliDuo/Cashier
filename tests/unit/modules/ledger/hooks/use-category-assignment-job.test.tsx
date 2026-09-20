import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCategoryAssignmentJob } from "@/modules/ledger/hooks/useCategoryAssignmentJob";

const { getJob, invalidateLedger } = vi.hoisted(() => ({
  getJob: vi.fn(),
  invalidateLedger: vi.fn(),
}));

vi.mock("@/lib/queries/ledger-query-client", () => ({
  getCategoryReclassificationJobAction: getJob,
}));
vi.mock("@/lib/mutations/ledger-invalidation", () => ({
  invalidateLedgerQueries: invalidateLedger,
}));

const runningJob = {
  id: "job-1",
  formatVersion: 2,
  mode: { kind: "clear" as const },
  status: "running" as const,
  total: 10,
  processedCount: 0,
  appliedCount: 0,
  confirmedCount: 0,
  failedCount: 0,
  conflictCount: 0,
  skippedCount: 0,
  cancelledCount: 0,
  documentTotal: 10,
  documentCompleted: 0,
  activeDocumentCount: 1,
  retryingDocumentCount: 0,
  nextRetryAt: null,
  candidateCategories: [],
  receivedCount: 10,
  errorCode: null,
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
  completedAt: null,
  canRetryFailed: false,
  evidenceIncomplete: false,
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** Settles a fetch and the render it triggers. */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useCategoryAssignmentJob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getJob.mockResolvedValue(runningJob);
    invalidateLedger.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("continues polling an active job beyond 205 seconds", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useCategoryAssignmentJob("ledger-1"), { wrapper });
    await flush();
    expect(result.current.job).toMatchObject({ id: "job-1", status: "running" });

    await act(async () => vi.advanceTimersByTimeAsync(210_000));

    expect(getJob.mock.calls.length).toBeGreaterThan(60);
    expect(result.current.job).toMatchObject({ status: "running" });
  });

  it("reports a query error without manufacturing a failed job", async () => {
    getJob.mockRejectedValue(new Error("offline"));
    const { wrapper } = setup();
    const { result } = renderHook(() => useCategoryAssignmentJob("ledger-1"), { wrapper });
    await flush();

    expect(result.current.isReadError).toBe(true);
    expect(result.current.job).toBeNull();
    expect(result.current.isVisible).toBe(true);
  });

  it("does not reprint a run that finished before this page opened", async () => {
    getJob.mockResolvedValue({ ...runningJob, status: "succeeded", processedCount: 10 });
    const { wrapper } = setup();
    const { result } = renderHook(() => useCategoryAssignmentJob("ledger-1"), { wrapper });
    await flush();

    expect(result.current.job).toMatchObject({ status: "succeeded" });
    expect(result.current.isVisible).toBe(false);
  });

  it("keeps a watched run's outcome visible until it is dismissed", async () => {
    const succeeded = {
      ...runningJob,
      status: "succeeded" as const,
      processedCount: 10,
      appliedCount: 9,
      confirmedCount: 1,
    };
    getJob.mockResolvedValueOnce(runningJob).mockResolvedValue(succeeded);
    const { wrapper } = setup();
    const { result } = renderHook(() => useCategoryAssignmentJob("ledger-1"), { wrapper });
    await flush();
    expect(result.current.isVisible).toBe(true);

    await act(async () => void (await result.current.refresh()));
    await flush();
    expect(result.current.job).toMatchObject({ status: "succeeded" });
    expect(result.current.isVisible).toBe(true);

    act(() => result.current.dismiss());
    expect(result.current.isVisible).toBe(false);
  });

  it("lets a later run announce itself after the previous one was dismissed", async () => {
    getJob
      .mockResolvedValueOnce(runningJob)
      .mockResolvedValueOnce({ ...runningJob, status: "succeeded", processedCount: 10 })
      .mockResolvedValue({ ...runningJob, id: "job-2", status: "running", processedCount: 0 });
    const { wrapper } = setup();
    const { result } = renderHook(() => useCategoryAssignmentJob("ledger-1"), { wrapper });
    await flush();
    act(() => result.current.dismiss());
    expect(result.current.isVisible).toBe(true);

    await act(async () => void (await result.current.refresh()));
    await flush();
    act(() => result.current.dismiss());
    expect(result.current.isVisible).toBe(false);

    await act(async () => void (await result.current.refresh()));
    await flush();

    expect(result.current.job).toMatchObject({ id: "job-2" });
    expect(result.current.isVisible).toBe(true);
  });

  it("never hides a live run behind a dismissal", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useCategoryAssignmentJob("ledger-1"), { wrapper });
    await flush();

    act(() => result.current.dismiss());
    await act(async () => vi.advanceTimersByTimeAsync(3_000));

    expect(result.current.job).toMatchObject({ status: "running" });
    expect(result.current.isVisible).toBe(true);
  });

  it("refreshes the ledger when a run stops where it stood", async () => {
    const failed = {
      ...runningJob,
      status: "failed" as const,
      completedAt: "2026-09-14T00:05:00.000Z",
    };
    const { wrapper } = setup();
    getJob.mockResolvedValueOnce(runningJob).mockResolvedValue(failed);
    const { result } = renderHook(() => useCategoryAssignmentJob("ledger-1"), { wrapper });
    await flush();
    expect(invalidateLedger).toHaveBeenCalledTimes(1);

    // The run ends without processing anything more than it already had.
    await act(async () => void (await result.current.refresh()));
    await flush();

    expect(result.current.job).toMatchObject({ status: "failed" });
    expect(invalidateLedger).toHaveBeenCalledTimes(2);
  });

  it("refreshes the ledger when a new run starts where the last one stopped", async () => {
    const previous = { ...runningJob, status: "succeeded" as const, processedCount: 10 };
    const next = { ...runningJob, id: "job-2", status: "running" as const, processedCount: 10 };
    const { wrapper } = setup();
    getJob.mockResolvedValueOnce(previous).mockResolvedValue(next);
    const { result } = renderHook(() => useCategoryAssignmentJob("ledger-1"), { wrapper });
    await flush();
    expect(invalidateLedger).toHaveBeenCalledTimes(1);

    await act(async () => void (await result.current.refresh()));
    await flush();

    expect(result.current.job).toMatchObject({ id: "job-2" });
    expect(invalidateLedger).toHaveBeenCalledTimes(2);
  });

  it("holds a progress refresh to one per interval and catches up at the end", async () => {
    const { wrapper } = setup();
    getJob.mockResolvedValue(runningJob);
    const { result } = renderHook(() => useCategoryAssignmentJob("ledger-1"), { wrapper });
    await flush();
    expect(invalidateLedger).toHaveBeenCalledTimes(1);

    getJob.mockResolvedValue({ ...runningJob, processedCount: 1 });
    await act(async () => void (await result.current.refresh()));
    await flush();
    expect(invalidateLedger).toHaveBeenCalledTimes(1);

    getJob.mockResolvedValue({ ...runningJob, processedCount: 2 });
    await act(async () => void (await result.current.refresh()));
    await flush();
    expect(invalidateLedger).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(3_000));

    expect(invalidateLedger).toHaveBeenCalledTimes(2);
  });

  it("queues one notice for the run this page watched until it is consumed", async () => {
    const { wrapper } = setup();
    const succeeded = {
      ...runningJob,
      status: "succeeded" as const,
      processedCount: 10,
      appliedCount: 9,
      confirmedCount: 1,
    };
    getJob.mockResolvedValueOnce(runningJob).mockResolvedValue(succeeded);
    const { result } = renderHook(() => useCategoryAssignmentJob("ledger-1"), { wrapper });
    await flush();
    expect(result.current.notices).toEqual([]);

    await act(async () => void (await result.current.refresh()));
    await flush();
    expect(result.current.notices.map((notice) => notice.jobId)).toEqual(["job-1"]);

    // Reading the same statement again is not a second piece of news.
    await act(async () => void (await result.current.refresh()));
    await flush();
    expect(result.current.notices.map((notice) => notice.jobId)).toEqual(["job-1"]);

    act(() => result.current.consumeNotice("job-1"));
    expect(result.current.notices).toEqual([]);
  });

  it("queues no notice for a run that ended before this page opened", async () => {
    getJob.mockResolvedValue({
      ...runningJob,
      status: "succeeded" as const,
      processedCount: 10,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useCategoryAssignmentJob("ledger-1"), { wrapper });
    await flush();

    expect(result.current.job).toMatchObject({ status: "succeeded" });
    expect(result.current.notices).toEqual([]);
  });

  it("queues a notice for the run this page submitted, even when it is already over", async () => {
    getJob.mockResolvedValue(null);
    const { wrapper } = setup();
    const { result } = renderHook(() => useCategoryAssignmentJob("ledger-1"), { wrapper });
    await flush();

    act(() =>
      result.current.registerSubmittedJob({
        ...runningJob,
        status: "succeeded",
        processedCount: 10,
      })
    );
    await flush();

    expect(result.current.job).toMatchObject({ id: "job-1", status: "succeeded" });
    expect(result.current.notices.map((notice) => notice.jobId)).toEqual(["job-1"]);
  });

  it("queues no notice for a run the reader stopped", async () => {
    const { wrapper } = setup();
    getJob
      .mockResolvedValueOnce(runningJob)
      .mockResolvedValue({ ...runningJob, status: "cancelled" as const, processedCount: 2 });
    const { result } = renderHook(() => useCategoryAssignmentJob("ledger-1"), { wrapper });
    await flush();

    await act(async () => void (await result.current.refresh()));
    await flush();

    expect(result.current.job).toMatchObject({ status: "cancelled" });
    expect(result.current.notices).toEqual([]);
  });
});
