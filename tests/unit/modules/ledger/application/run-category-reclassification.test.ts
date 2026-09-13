import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runCategoryReclassification,
  type CategoryReclassificationDependencies,
} from "@/modules/ledger/application/use-cases/run-category-reclassification";
import type {
  CategoryReclassificationJobPort,
  ClaimedCategoryReclassificationJob,
  EntryCategoryAssignmentPort,
  EntryReclassifierPort,
} from "@/modules/ledger/application/ports";
import type { ReclassificationDocumentGroup } from "@/modules/ledger/application/reclassification-protocol";

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

interface DocumentFixture {
  sourceDocumentId: string;
  ledgerEntryIds: readonly string[];
  storedFileIds?: readonly string[];
}

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

function setup(options: { documents?: readonly DocumentFixture[] } = {}): {
  deps: CategoryReclassificationDependencies;
  recordProgress: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  loadDocumentGroups: ReturnType<typeof vi.fn>;
  assign: ReturnType<typeof vi.fn>;
  decide: ReturnType<typeof vi.fn>;
  loadStoredFiles: ReturnType<typeof vi.fn>;
} {
  const documents: readonly DocumentFixture[] = options.documents ?? [
    { sourceDocumentId: "doc-1", ledgerEntryIds: entryIds(3) },
  ];

  const recordProgress = vi.fn().mockResolvedValue(true);
  const complete = vi.fn().mockResolvedValue(true);
  const jobs = { recordProgress, complete } as unknown as CategoryReclassificationJobPort;

  const loadDocumentGroups = vi.fn(
    async (input: {
      ledgerEntryIds: readonly string[];
    }): Promise<ReclassificationDocumentGroup[]> => {
      const requested = new Set(input.ledgerEntryIds);
      return documents.flatMap((document) => {
        const subjects = document.ledgerEntryIds.filter((id) => requested.has(id));
        if (subjects.length === 0) return [];
        return [
          {
            sourceDocumentId: document.sourceDocumentId,
            title: null,
            documentDate: null,
            inputText: null,
            storedFileIds: document.storedFileIds ?? [],
            subjects: subjects.map((ledgerEntryId) => ({
              ledgerEntryId,
              itemName: `Item ${ledgerEntryId}`,
              description: null,
              amount: "1.00",
              currency: "CNY",
              currentCategoryId: null,
              currentCategoryName: null,
            })),
          },
        ];
      });
    }
  );
  const assign = vi.fn(async (input: { decisions: readonly { ledgerEntryId: string }[] }) => ({
    appliedCount: input.decisions.length,
  }));
  const assignment = { loadDocumentGroups, assign } as unknown as EntryCategoryAssignmentPort;

  const loadStoredFiles = vi.fn(async () => [{ dataUrl: "data:image/jpeg;base64,AAA" }]);

  const decide = vi.fn(async (input: { group: ReclassificationDocumentGroup }) => ({
    decisions: input.group.subjects.map((subject, index) => ({
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
    loadStoredFiles,
    now: new Date("2026-01-01T00:00:00.000Z"),
  };
  return { deps, recordProgress, complete, loadDocumentGroups, assign, decide, loadStoredFiles };
}

describe("runCategoryReclassification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks once per document and applies every decision in a single write", async () => {
    const { deps, recordProgress, complete, decide, assign } = setup();

    const outcome = await runCategoryReclassification(job({ ledgerEntryIds: entryIds(3) }), deps);

    expect(decide).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledOnce();
    expect(assign.mock.calls[0]![0].decisions).toHaveLength(3);
    expect(recordProgress).toHaveBeenCalledWith({
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

  it("makes one call per document but still writes once for the whole run", async () => {
    const { deps, decide, assign, recordProgress } = setup({
      documents: [
        { sourceDocumentId: "doc-1", ledgerEntryIds: ["entry-1", "entry-2"] },
        { sourceDocumentId: "doc-2", ledgerEntryIds: ["entry-3"] },
        { sourceDocumentId: "doc-3", ledgerEntryIds: ["entry-4"] },
      ],
    });

    const outcome = await runCategoryReclassification(job({ ledgerEntryIds: entryIds(4) }), deps);

    expect(decide).toHaveBeenCalledTimes(3);
    expect(assign).toHaveBeenCalledOnce();
    // Merged in document order, not in whatever order the provider answered.
    expect(assign.mock.calls[0]![0].decisions).toEqual([
      { ledgerEntryId: "entry-1", categoryId: "cat-a" },
      { ledgerEntryId: "entry-2", categoryId: "cat-b" },
      { ledgerEntryId: "entry-3", categoryId: "cat-a" },
      { ledgerEntryId: "entry-4", categoryId: "cat-a" },
    ]);
    expect(recordProgress).toHaveBeenCalledOnce();
    expect(outcome).toMatchObject({ completed: true, cursor: 4, appliedCount: 4 });
  });

  it("loads a document's evidence once, not once per entry", async () => {
    const { deps, decide, loadStoredFiles } = setup({
      documents: [
        { sourceDocumentId: "doc-1", ledgerEntryIds: entryIds(3), storedFileIds: ["f1", "f2"] },
      ],
    });

    await runCategoryReclassification(job({ ledgerEntryIds: entryIds(3) }), deps);

    expect(loadStoredFiles).toHaveBeenCalledOnce();
    expect(loadStoredFiles).toHaveBeenCalledWith({
      ledgerId: "ledger-1",
      storedFileIds: ["f1", "f2"],
    });
    expect(decide).toHaveBeenCalledOnce();
    expect(decide.mock.calls[0]![0].images).toEqual([{ dataUrl: "data:image/jpeg;base64,AAA" }]);
  });

  it("does not go looking for evidence on a document that has none", async () => {
    const { deps, decide, loadStoredFiles } = setup({
      documents: [{ sourceDocumentId: "doc-1", ledgerEntryIds: entryIds(2) }],
    });

    await runCategoryReclassification(job({ ledgerEntryIds: entryIds(2) }), deps);

    expect(loadStoredFiles).not.toHaveBeenCalled();
    expect(decide.mock.calls[0]![0].images).toEqual([]);
  });

  it("fails the whole run when one document's model call fails", async () => {
    const { deps, decide, assign, recordProgress, complete } = setup({
      documents: [
        { sourceDocumentId: "doc-1", ledgerEntryIds: ["entry-1"] },
        { sourceDocumentId: "doc-2", ledgerEntryIds: ["entry-2"] },
      ],
    });
    decide
      .mockResolvedValueOnce({ decisions: [], confirmedCount: 0 })
      .mockRejectedValueOnce(new Error("model failed"));

    await expect(
      runCategoryReclassification(job({ ledgerEntryIds: entryIds(2) }), deps)
    ).rejects.toThrow("model failed");
    expect(assign).not.toHaveBeenCalled();
    expect(recordProgress).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("leaves the cursor alone when the write fails", async () => {
    const { deps, recordProgress, complete, assign } = setup();
    assign.mockRejectedValueOnce(new Error("write failed"));

    await expect(
      runCategoryReclassification(job({ ledgerEntryIds: entryIds(3) }), deps)
    ).rejects.toThrow("write failed");
    expect(recordProgress).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("stops at once when the lease is taken over", async () => {
    const { deps, recordProgress, complete } = setup();
    recordProgress.mockResolvedValueOnce(false);

    const outcome = await runCategoryReclassification(job({ ledgerEntryIds: entryIds(3) }), deps);

    expect(complete).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ completed: false, cursor: 3 });
  });

  it("skips the model entirely when nothing is left to ask about", async () => {
    const { deps, decide, assign, loadDocumentGroups } = setup();
    loadDocumentGroups.mockResolvedValueOnce([]);

    const outcome = await runCategoryReclassification(job({ ledgerEntryIds: entryIds(3) }), deps);

    expect(decide).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      completed: true,
      cursor: 3,
      appliedCount: 0,
      confirmedCount: 0,
    });
  });

  it("asks about every entry even when the job carries a stored cursor", async () => {
    // A document cannot start mid-way: the grouping is what the model sees, so
    // a run always asks about the whole batch rather than the leftover tail.
    const { deps, loadDocumentGroups, recordProgress } = setup();

    await runCategoryReclassification(
      job({ ledgerEntryIds: entryIds(50), cursor: 40, appliedCount: 40, confirmedCount: 2 }),
      deps
    );

    expect(loadDocumentGroups).toHaveBeenCalledWith({
      ledgerId: "ledger-1",
      ledgerEntryIds: entryIds(50),
    });
    expect(recordProgress).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 50, confirmedCount: 2 })
    );
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
