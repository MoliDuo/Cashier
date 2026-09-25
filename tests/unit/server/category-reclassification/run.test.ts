import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  concurrency: 100,
  queue: [] as Array<Record<string, unknown>>,
  active: 0,
  maxActive: 0,
  decideCalls: 0,
}));

const adapters = vi.hoisted(() => ({
  claimDocuments: vi.fn(async (input: { concurrency: number }) =>
    state.queue.splice(0, input.concurrency)
  ),
  loadDocumentSelection: vi.fn(async (input: { sourceDocumentId: string }) => ({
    entryIds: [`entry-${input.sourceDocumentId}`],
    completedChunkCount: 0,
  })),
  nextDue: vi.fn(async (): Promise<Date | null> => null),
  renewDocumentClaim: vi.fn(async () => true),
  persistDecisions: vi.fn(async (_input: { completedChunkCount: number }) => true),
  markEvidenceIncomplete: vi.fn(async () => undefined),
  failDocument: vi.fn(async () => "failed"),
  loadDocumentGroups: vi.fn(async (input: { ledgerEntryIds: string[] }) => {
    const sourceDocumentId = input.ledgerEntryIds[0]!.replace("entry-", "");
    return [
      {
        sourceDocumentId,
        title: null,
        documentDate: null,
        inputText: null,
        storedFileIds: [],
        subjects: [
          {
            ledgerEntryId: input.ledgerEntryIds[0]!,
            itemName: "Item",
            description: null,
            amount: "1.00",
            currency: "CNY",
            currentCategoryId: null,
            currentCategoryName: null,
          },
        ],
      },
    ];
  }),
  decide: vi.fn(async (input: { group: { subjects: Array<{ ledgerEntryId: string }> } }) => {
    state.active += 1;
    state.maxActive = Math.max(state.maxActive, state.active);
    state.decideCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    state.active -= 1;
    return {
      decisions: [
        { ledgerEntryId: input.group.subjects[0]!.ledgerEntryId, categoryId: "category-1" },
      ],
      confirmedCount: 0,
    };
  }),
  applyCategoryAssignments: vi.fn(async () => ({
    status: "applied",
    appliedCount: 1,
    confirmedCount: 0,
    version: 2,
  })),
}));

vi.mock("@/config/tuning", () => ({
  get AI_CATEGORY_CONCURRENCY() {
    return state.concurrency;
  },
  AI_CATEGORY_MAX_ATTEMPTS: 3,
  CATEGORY_RUN_BUDGET_MS: 50_000,
}));
vi.mock("@/server/category-reclassification/assignments", () => ({
  claimCategoryAssignmentDocuments: adapters.claimDocuments,
  loadCategoryAssignmentSelection: adapters.loadDocumentSelection,
  nextCategoryAssignmentDue: adapters.nextDue,
  renewCategoryAssignmentClaim: adapters.renewDocumentClaim,
  persistCategoryAssignmentDecisions: adapters.persistDecisions,
  markCategoryAssignmentEvidenceIncomplete: adapters.markEvidenceIncomplete,
  failCategoryAssignmentDocument: adapters.failDocument,
}));
vi.mock("@/server/category-reclassification/document-groups", () => ({
  loadReclassificationDocumentGroups: adapters.loadDocumentGroups,
}));
vi.mock("@/modules/source-document/server/category-assignments", () => ({
  applyCategoryAssignments: adapters.applyCategoryAssignments,
}));
vi.mock("@/server/category-reclassification/reclassifier", () => ({
  decideEntryCategories: adapters.decide,
}));
vi.mock("@/server/processing/evidence", () => ({
  loadStoredFilesForAI: vi.fn(async () => []),
  isSuccessfulLoadImageResult: () => false,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/lib/security/log-identifier", () => ({ logIdentifier: () => "hashed" }));

import { runCategoryReclassificationJob } from "@/server/category-reclassification/run";

function work(index: number) {
  return {
    jobId: "job-1",
    ledgerId: "ledger-1",
    sourceDocumentId: `document-${index}`,
    expectedVersion: 1,
    revisionId: `revision-${index}`,
    claimToken: `claim-${index}`,
    attempts: 1,
    mode: { kind: "ai" as const, candidateCategoryIds: ["category-1", "category-2"] },
    candidates: [
      { id: "category-1", name: "One", description: null },
      { id: "category-2", name: "Two", description: null },
    ],
    customPrompt: null,
  };
}

describe("category reclassification orchestration concurrency", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    state.queue = Array.from({ length: 100 }, (_, index) => work(index));
    state.active = 0;
    state.maxActive = 0;
    state.decideCalls = 0;
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it("starts 100 independent document requests in one 20-second batch by default", async () => {
    state.concurrency = 100;
    const startedAt = Date.now();
    const running = runCategoryReclassificationJob("job-1");
    await vi.runAllTimersAsync();
    await running;

    expect(state.maxActive).toBe(100);
    expect(state.decideCalls).toBe(100);
    expect(Date.now() - startedAt).toBe(20_000);
  });

  it("honors a concurrency of 10 and stops claiming once the run budget is spent", async () => {
    state.concurrency = 10;
    const startedAt = Date.now();
    const first = runCategoryReclassificationJob("job-1");
    await vi.runAllTimersAsync();
    await first;

    // Batches start at 0s, 20s and 40s; at 60s the 50-second budget is spent.
    expect(state.maxActive).toBe(10);
    expect(state.decideCalls).toBe(30);
    expect(Date.now() - startedAt).toBe(60_000);

    const second = runCategoryReclassificationJob("job-1");
    await vi.runAllTimersAsync();
    await second;
    expect(state.decideCalls).toBe(60);
  });

  it("returns instead of waiting when every slot is held by another run", async () => {
    state.queue = [];
    adapters.nextDue.mockResolvedValueOnce(new Date(Date.now() - 1_000));

    await expect(runCategoryReclassificationJob("job-1")).resolves.toBe(false);
    expect(adapters.claimDocuments).toHaveBeenCalledTimes(1);
    expect(adapters.nextDue).toHaveBeenCalledTimes(1);
  });

  it("isolates one failed document without repeating the other 99 requests", async () => {
    state.concurrency = 100;
    adapters.decide.mockRejectedValueOnce(new Error("timeout"));
    const running = runCategoryReclassificationJob("job-1");
    await vi.runAllTimersAsync();
    await running;

    expect(adapters.decide).toHaveBeenCalledTimes(100);
    expect(adapters.failDocument).toHaveBeenCalledTimes(1);
    expect(adapters.applyCategoryAssignments).toHaveBeenCalledTimes(99);
  });

  it("splits 120 entries from one document into three persisted request blocks", async () => {
    state.concurrency = 100;
    state.queue = [work(1)];
    const entryIds = Array.from({ length: 120 }, (_, index) => `entry-${index}`);
    adapters.loadDocumentSelection.mockResolvedValueOnce({
      entryIds,
      completedChunkCount: 0,
    });
    adapters.loadDocumentGroups.mockResolvedValueOnce([
      {
        sourceDocumentId: "document-1",
        title: null,
        documentDate: null,
        inputText: null,
        storedFileIds: [],
        subjects: entryIds.map((ledgerEntryId) => ({
          ledgerEntryId,
          itemName: ledgerEntryId,
          description: null,
          amount: "1.00",
          currency: "CNY",
          currentCategoryId: null,
          currentCategoryName: null,
        })),
      },
    ]);
    adapters.decide.mockImplementation(
      async (input: { group: { subjects: Array<{ ledgerEntryId: string }> } }) => {
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        return {
          decisions: input.group.subjects.map((subject) => ({
            ledgerEntryId: subject.ledgerEntryId,
            categoryId: "category-1",
          })),
          confirmedCount: 0,
        };
      }
    );

    const running = runCategoryReclassificationJob("job-1");
    await vi.runAllTimersAsync();
    await running;

    expect(adapters.decide.mock.calls.map(([input]) => input.group.subjects.length)).toEqual([
      50, 50, 20,
    ]);
    expect(
      adapters.persistDecisions.mock.calls.map(([input]) => input.completedChunkCount)
    ).toEqual([1, 2, 3]);
  });
});
