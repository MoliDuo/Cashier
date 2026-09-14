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
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(result.current.job).toMatchObject({ id: "job-1", status: "running" });

    await act(async () => vi.advanceTimersByTimeAsync(210_000));

    expect(getJob.mock.calls.length).toBeGreaterThan(60);
    expect(result.current.job).toMatchObject({ status: "running" });
  });

  it("reports a query error without manufacturing a failed job", async () => {
    getJob.mockRejectedValue(new Error("offline"));
    const { wrapper } = setup();
    const { result } = renderHook(() => useCategoryAssignmentJob("ledger-1"), { wrapper });
    await act(async () => vi.advanceTimersByTimeAsync(0));

    expect(result.current.isReadError).toBe(true);
    expect(result.current.job).toBeNull();
  });
});
