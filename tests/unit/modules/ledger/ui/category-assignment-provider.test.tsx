import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryReclassificationJob } from "@/modules/ledger/contracts";
import { CategoryAssignmentProvider } from "@/modules/ledger/ui/CategoryAssignmentProvider";
import { useCategoryAssignment } from "@/modules/ledger/ui/category-assignment-context";

const { getJob, toastSuccess, toastError, featureMessages } = vi.hoisted(() => ({
  getJob: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** Stands in for the deferred details messages the boundary fetches. */
  featureMessages: { ready: true },
}));

vi.mock("@/lib/queries/ledger-query-client", () => ({
  getCategoryReclassificationJobAction: getJob,
  getCategoryAssignmentResultsAction: vi.fn(async () => ({ items: [], nextCursor: null })),
}));
vi.mock("@/lib/mutations/ledger-invalidation", () => ({
  invalidateLedgerQueries: vi.fn(async () => undefined),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("next-intl", () => ({
  // The counts are the message: they are what the reader is told, so the mock
  // spells them out instead of dropping them.
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values == null ? key : `${key}(${values.applied}/${values.confirmed}/${values.issues})`,
  useLocale: () => "zh",
}));
vi.mock("@/i18n/DeferredFeatureMessages", () => ({
  DeferredFeatureMessages: ({ children }: PropsWithChildren) =>
    featureMessages.ready ? <>{children}</> : null,
}));
vi.mock("@/modules/ledger/server-actions/reclassification", () => ({
  cancelCategoryAssignmentAction: vi.fn(),
  retryCategoryAssignmentFailuresAction: vi.fn(),
  retryCategoryAssignmentLatestAction: vi.fn(),
}));

function job(overrides: Partial<CategoryReclassificationJob> = {}): CategoryReclassificationJob {
  return {
    id: "job-1",

    mode: { kind: "ai", candidateCategoryIds: ["category-1"] },
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
    ...overrides,
  };
}

const succeededJob = () =>
  job({
    status: "succeeded",
    processedCount: 10,
    appliedCount: 9,
    confirmedCount: 1,
    documentCompleted: 10,
    activeDocumentCount: 0,
    completedAt: "2026-09-14T00:05:00.000Z",
  });

/** Asks the page for a run, the way the batch toolbar does after a submit. */
function SubmitProbe({ run }: { run: CategoryReclassificationJob }) {
  const { registerSubmittedJob, job: current } = useCategoryAssignment();
  return (
    <>
      <span data-testid="job-status">{current?.status ?? "none"}</span>
      <button type="button" onClick={() => registerSubmittedJob(run)}>
        submit
      </button>
    </>
  );
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <CategoryAssignmentProvider ledgerId="ledger-1">{children}</CategoryAssignmentProvider>
    </QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** Waits out the poll that reads the run's next state. */
async function poll(queryClient: QueryClient) {
  await act(async () => {
    await queryClient.refetchQueries({
      queryKey: ["ledger", "ledger-1", "category-reclassification"],
    });
  });
}

/** The band appears only once the page has a run to describe. */
async function waitForBand() {
  await waitFor(() => expect(document.getElementById("category-assignment-status")).not.toBeNull());
}

describe("CategoryAssignmentProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureMessages.ready = true;
    getJob.mockResolvedValue(null);
  });

  it("reports a run this page watched once it ends", async () => {
    getJob.mockResolvedValueOnce(job()).mockResolvedValue(succeededJob());
    const { queryClient, wrapper } = setup();
    render(<SubmitProbe run={job()} />, { wrapper });

    await waitForBand();
    await poll(queryClient);

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("aiCategoryDone(9/1/0)"));
    // A statement of the ledger's most recent run is not news a second time.
    await poll(queryClient);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("reports a run the page submitted even when it is already over", async () => {
    getJob.mockResolvedValue(null);
    const { wrapper } = setup();
    render(<SubmitProbe run={succeededJob()} />, { wrapper });
    await waitFor(() => expect(getJob).toHaveBeenCalled());

    fireEvent.click(screen.getByText("submit"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("aiCategoryDone(9/1/0)"));
  });

  it("stays quiet about a run that ended before this page opened", async () => {
    getJob.mockResolvedValue(succeededJob());
    const { queryClient, wrapper } = setup();
    render(<SubmitProbe run={succeededJob()} />, { wrapper });

    await waitFor(() => expect(getJob).toHaveBeenCalled());
    await poll(queryClient);

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("does not report a run the reader stopped", async () => {
    const cancelled = job({
      status: "cancelled",
      processedCount: 2,
      cancelledCount: 8,
      completedAt: "2026-09-14T00:02:00.000Z",
    });
    getJob.mockResolvedValueOnce(job()).mockResolvedValue(cancelled);
    const { queryClient, wrapper } = setup();
    render(<SubmitProbe run={job()} />, { wrapper });

    await waitForBand();
    await poll(queryClient);

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("holds a notice until the messages it speaks in have loaded", async () => {
    featureMessages.ready = false;
    getJob.mockResolvedValueOnce(job()).mockResolvedValue(succeededJob());
    const { queryClient, wrapper } = setup();
    const view = render(<SubmitProbe run={job()} />, { wrapper });

    await waitFor(() => expect(screen.getByTestId("job-status")).toHaveTextContent("running"));
    await poll(queryClient);
    expect(toastSuccess).not.toHaveBeenCalled();

    featureMessages.ready = true;
    view.rerender(<SubmitProbe run={job()} />);

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
  });

  it("shows the status band above the page while a run is moving", async () => {
    getJob.mockResolvedValue(job());
    const { wrapper } = setup();
    render(<SubmitProbe run={job()} />, { wrapper });

    await waitFor(() =>
      expect(document.getElementById("category-assignment-status")).not.toBeNull()
    );
  });

  it("starts from a clean history when the page moves to another ledger", async () => {
    getJob.mockResolvedValueOnce(job()).mockResolvedValue(succeededJob());
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const ledgerPage = (ledgerId: string) => (
      <QueryClientProvider client={queryClient}>
        <CategoryAssignmentProvider key={ledgerId} ledgerId={ledgerId}>
          <SubmitProbe run={job()} />
        </CategoryAssignmentProvider>
      </QueryClientProvider>
    );
    const view = render(ledgerPage("ledger-1"));
    await waitForBand();
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ["ledger", "ledger-1", "category-reclassification"],
      });
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    toastSuccess.mockClear();

    // The same finished run is the second ledger's history, not this reader's
    // news, so the fresh page reports nothing.
    view.rerender(ledgerPage("ledger-2"));

    await waitFor(() =>
      expect(
        queryClient.getQueryData(["ledger", "ledger-2", "category-reclassification"])
      ).toMatchObject({ id: "job-1", status: "succeeded" })
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(document.getElementById("category-assignment-status")).toBeNull();
  });

  it("refuses to be read outside the provider", () => {
    function Outside() {
      useCategoryAssignment();
      return null;
    }
    expect(() => render(<Outside />)).toThrow(/CategoryAssignmentProvider/);
  });
});
