import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runCategoryReclassification,
  RECLASSIFICATION_SLICE_SIZE,
  type CategoryReclassificationDependencies,
} from "@/modules/ledger/application/use-cases/run-category-reclassification";
import type {
  CategoryReclassificationJobPort,
  ClaimedCategoryReclassificationJob,
  EntryCategoryAssignmentPort,
  EntryReclassifierPort,
} from "@/modules/ledger/application/ports";
import type { ReclassificationSubject } from "@/modules/ledger/application/reclassification-protocol";

const CANDIDATE_IDS = ["cat-a", "cat-b"];
const CATEGORY_ROWS = [
  {
    id: "cat-a",
    ledgerId: "ledger-1",
    name: "吃喝",
    description: null,
    icon: null,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "cat-b",
    ledgerId: "ledger-1",
    name: "居家",
    description: null,
    icon: null,
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

function entryIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `entry-${index + 1}`);
}

function job(
  overrides: Partial<ClaimedCategoryReclassificationJob> = {}
): ClaimedCategoryReclassificationJob {
  return {
    id: "job-1",
    ledgerId: "ledger-1",
    status: "running",
    ledgerEntryIds: entryIds(3),
    candidateCategoryIds: CANDIDATE_IDS,
    cursor: 0,
    appliedCount: 0,
    confirmedCount: 0,
    attempts: 0,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    claimToken: "token-1",
    ...overrides,
  };
}

function setup() {
  const recordProgress = vi.fn().mockResolvedValue(true);
  const complete = vi.fn().mockResolvedValue(true);
  const jobs = { recordProgress, complete } as unknown as CategoryReclassificationJobPort;
  const subjects: ReclassificationSubject[] = [];
  const loadSubjects = vi.fn(async (input: { ledgerEntryIds: readonly string[] }) =>
    input.ledgerEntryIds.map((ledgerEntryId, index) => ({
      ledgerEntryId,
      itemName: `Item ${index + 1}`,
      description: null,
      amount: "1.00",
      currency: "CNY",
      currentCategoryId: null,
      currentCategoryName: null,
    }))
  );
  const assign = vi.fn(async (input: { decisions: readonly { ledgerEntryId: string }[] }) => ({
    appliedCount: input.decisions.length,
  }));
  const assignment = { loadSubjects, assign } as unknown as EntryCategoryAssignmentPort;
  const decide = vi.fn(async (input: { subjects: readonly ReclassificationSubject[] }) => ({
    decisions: input.subjects.map((subject, index) => ({
      ledgerEntryId: subject.ledgerEntryId,
      categoryId: index % 2 === 0 ? "cat-a" : "cat-b",
    })),
    confirmedCount: 0,
  }));
  const reclassifier = { decide } as unknown as EntryReclassifierPort;
  const categories = { list: vi.fn().mockResolvedValue(CATEGORY_ROWS) };

  const deps: CategoryReclassificationDependencies = {
    jobs,
    assignment,
    reclassifier,
    categories,
    now: new Date("2026-01-01T00:00:00.000Z"),
  };
  return { deps, recordProgress, complete, loadSubjects, assign, decide, subjects };
}

describe("runCategoryReclassification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies one slice at a time and records progress after each", async () => {
    const { deps, recordProgress, complete, decide } = setup();

    const outcome = await runCategoryReclassification(job({ ledgerEntryIds: entryIds(3) }), deps);

    expect(decide).toHaveBeenCalledOnce();
    expect(recordProgress).toHaveBeenNthCalledWith(1, {
      jobId: "job-1",
      claimToken: "token-1",
      cursor: 3,
      appliedCount: 3,
      confirmedCount: 0,
      now: deps.now,
    });
    expect(complete).toHaveBeenCalledOnce();
    expect(outcome).toEqual({ completed: true, cursor: 3, appliedCount: 3, confirmedCount: 0 });
  });

  it("splits a run longer than one slice into separate model calls", async () => {
    const total = RECLASSIFICATION_SLICE_SIZE * 2 + 5;
    const { deps, decide, recordProgress } = setup();

    const outcome = await runCategoryReclassification(
      job({ ledgerEntryIds: entryIds(total) }),
      deps
    );

    expect(decide).toHaveBeenCalledTimes(3);
    expect(recordProgress).toHaveBeenCalledTimes(3);
    expect(outcome).toMatchObject({ completed: true, cursor: total, appliedCount: total });
  });

  it("stops at once when the lease is taken over", async () => {
    const { deps, recordProgress, complete, decide } = setup();
    recordProgress.mockResolvedValueOnce(false);

    const outcome = await runCategoryReclassification(job({ ledgerEntryIds: entryIds(50) }), deps);

    expect(decide).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ completed: false, cursor: RECLASSIFICATION_SLICE_SIZE });
  });

  it("leaves the cursor before the failing slice", async () => {
    const { deps, recordProgress, assign } = setup();
    assign.mockRejectedValueOnce(new Error("write failed"));

    await expect(
      runCategoryReclassification(job({ ledgerEntryIds: entryIds(50) }), deps)
    ).rejects.toThrow("write failed");
    expect(recordProgress).not.toHaveBeenCalled();
  });

  it("resumes after a stored cursor without asking about the prefix again", async () => {
    const { deps, decide, loadSubjects } = setup();

    await runCategoryReclassification(
      job({
        ledgerEntryIds: entryIds(50),
        cursor: RECLASSIFICATION_SLICE_SIZE * 2,
        appliedCount: 40,
        confirmedCount: 2,
      }),
      deps
    );

    expect(loadSubjects).toHaveBeenCalledOnce();
    expect(loadSubjects.mock.calls[0]![0].ledgerEntryIds).toEqual(entryIds(50).slice(40));
    expect(decide).toHaveBeenCalledOnce();
  });

  it("skips the model call when a slice has nothing left to ask about", async () => {
    const { deps, decide, loadSubjects, assign } = setup();
    loadSubjects.mockResolvedValueOnce([]);

    const outcome = await runCategoryReclassification(job({ ledgerEntryIds: entryIds(3) }), deps);

    expect(decide).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ completed: true, cursor: 3, appliedCount: 0 });
  });

  it("refuses to run when fewer than two candidates are still live", async () => {
    const { deps, decide } = setup();
    deps.categories = {
      list: vi.fn().mockResolvedValue([CATEGORY_ROWS[0]!]),
    } as unknown as CategoryReclassificationDependencies["categories"];

    await expect(runCategoryReclassification(job(), deps)).rejects.toMatchObject({
      code: "RECLASSIFICATION_CANDIDATES_UNAVAILABLE",
    });
    expect(decide).not.toHaveBeenCalled();
  });
});
