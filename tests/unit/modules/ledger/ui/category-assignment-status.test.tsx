import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryReclassificationJob } from "@/modules/ledger/contracts";
import { CategoryAssignmentStatus } from "@/modules/ledger/ui/CategoryAssignmentStatus";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values == null
      ? key
      : `${key}:${Object.entries(values)
          .map(([name, value]) => `${name}=${value}`)
          .join(",")}`,
}));
vi.mock("@/modules/ledger/server-actions/reclassification", () => ({
  cancelCategoryAssignmentAction: vi.fn(),
  retryCategoryAssignmentFailuresAction: vi.fn(),
  retryCategoryAssignmentLatestAction: vi.fn(),
}));
vi.mock("@/lib/queries/ledger-query-client", () => ({
  getCategoryAssignmentResultsAction: vi.fn(async () => ({ items: [], nextCursor: null })),
}));

function job(overrides: Partial<CategoryReclassificationJob> = {}): CategoryReclassificationJob {
  return {
    id: "job-1",
    formatVersion: 2,
    mode: { kind: "clear" },
    status: "running",
    total: 10,
    processedCount: 4,
    appliedCount: 3,
    confirmedCount: 1,
    failedCount: 0,
    conflictCount: 0,
    skippedCount: 0,
    cancelledCount: 0,
    documentTotal: 10,
    documentCompleted: 4,
    activeDocumentCount: 2,
    retryingDocumentCount: 1,
    nextRetryAt: "2026-09-14T00:00:05.000Z",
    candidateCategories: [],
    receivedCount: 10,
    errorCode: null,
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    completedAt: null,
    canRetryFailed: false,
    evidenceIncomplete: false,
    ...overrides,
  };
}

function renderStatus(props: Partial<React.ComponentProps<typeof CategoryAssignmentStatus>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const onTaskRegistered = vi.fn();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = render(
    <CategoryAssignmentStatus
      ledgerId="ledger-1"
      job={job()}
      isReadError={false}
      onRefresh={vi.fn()}
      onTaskRegistered={onTaskRegistered}
      {...props}
    />,
    { wrapper }
  );
  return { ...view, queryClient, onTaskRegistered };
}

describe("CategoryAssignmentStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T00:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("shows running progress, retry countdown, and the stop consequence", () => {
    renderStatus();

    expect(
      screen.getByText("categoryJobProgress:processed=4,total=10,active=2")
    ).toBeInTheDocument();
    expect(screen.getByText("categoryJobRetrying:count=1,seconds=5")).toBeInTheDocument();
    expect(screen.getByText("categoryStopDescription")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /categoryStop/ })).toBeEnabled();
  });

  it("keeps a read failure separate from the last known server job", () => {
    renderStatus({ isReadError: true });

    expect(screen.getByText("categoryJobReadFailed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /categoryRefreshStatus/ })).toBeEnabled();
    expect(screen.queryByText("categoryJobFailed")).not.toBeInTheDocument();
  });

  it("offers latest-content categorization for conflicts", () => {
    renderStatus({ job: job({ status: "partial", conflictCount: 1 }) });

    fireEvent.click(screen.getByRole("button", { name: /categoryViewResults/ }));
    expect(screen.getByRole("button", { name: /categoryRetryLatest/ })).toBeEnabled();
  });

  it("hands the run a retry restarted back to the page", async () => {
    const { retryCategoryAssignmentLatestAction } =
      await import("@/modules/ledger/server-actions/reclassification");
    const restarted = job({ id: "job-2", status: "running", processedCount: 0 });
    vi.mocked(retryCategoryAssignmentLatestAction).mockResolvedValue(restarted);
    const { onTaskRegistered, queryClient } = renderStatus({
      job: job({ status: "partial", conflictCount: 1 }),
    });

    fireEvent.click(screen.getByRole("button", { name: /categoryViewResults/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /categoryRetryLatest/ }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onTaskRegistered).toHaveBeenCalledWith(restarted);
    // The page owns the cache write now, so the band must not also make one.
    expect(
      queryClient.getQueryData(["ledger", "ledger-1", "category-reclassification"])
    ).toBeUndefined();
  });

  it("lets a finished run's band be closed", () => {
    const onDismiss = vi.fn();
    renderStatus({ job: job({ status: "succeeded", processedCount: 10 }), onDismiss });

    fireEvent.click(screen.getByRole("button", { name: "close" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("offers no close control while the run is still moving", () => {
    renderStatus({ onDismiss: vi.fn() });

    expect(screen.queryByRole("button", { name: "close" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /categoryStop/ })).toBeEnabled();
  });

  it("keeps the close control off a read failure that is still polling", () => {
    renderStatus({ isReadError: true, onDismiss: vi.fn() });

    expect(screen.queryByRole("button", { name: "close" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /categoryRefreshStatus/ })).toBeEnabled();
  });

  it("lets a read failure with no run to report be closed", () => {
    const onDismiss = vi.fn();
    renderStatus({ isReadError: true, job: null, onDismiss });

    fireEvent.click(screen.getByRole("button", { name: "close" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
