import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
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
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <CategoryAssignmentStatus
      ledgerId="ledger-1"
      job={job()}
      isReadError={false}
      onRefresh={vi.fn()}
      {...props}
    />,
    { wrapper }
  );
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
});
