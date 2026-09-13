import type { CategoryPort } from "@/application/contracts";
import { AppError } from "@/lib/errors";
import type {
  CategoryReclassificationJobPort,
  ClaimedCategoryReclassificationJob,
  EntryCategoryAssignmentPort,
  EntryReclassifierPort,
} from "../ports";
import type { ReclassificationCandidate } from "../reclassification-protocol";

export interface CategoryReclassificationDependencies {
  jobs: CategoryReclassificationJobPort;
  assignment: EntryCategoryAssignmentPort;
  reclassifier: EntryReclassifierPort;
  categories: Pick<CategoryPort, "list">;
  /**
   * Evidence for one document's stored files, already narrowed to the ones that
   * loaded. A file that cannot be read is logged where it fails and simply does
   * not travel — one broken object must not sink the run.
   */
  loadStoredFiles: (input: {
    ledgerId: string;
    storedFileIds: readonly string[];
  }) => Promise<readonly { dataUrl: string }[]>;
  now: Date;
  customPrompt?: string;
}

export interface CategoryReclassificationOutcome {
  /** False when the lease was taken over mid-run and the work was abandoned. */
  completed: boolean;
  cursor: number;
  appliedCount: number;
  confirmedCount: number;
}

/**
 * Walk a claimed run in one round: every source document concurrently, then a
 * single write.
 *
 * Slicing by document rather than by entry is what lets a receipt's evidence
 * travel with its line items — the images hang off the revision, so grouping
 * sends each picture once instead of once per entry.
 *
 * The candidate list is resolved once, before the first model call, and reused
 * for every document. Its order is the index base the model answers in, so
 * letting it shift between calls would silently remap answers onto the wrong
 * categories. A candidate deleted mid-run therefore does not renumber anything:
 * `assign` simply stops matching it.
 *
 * The calls happen outside any transaction or ledger lock, and the run is
 * all-or-nothing: every decision is applied by one `assign` once every document
 * has answered. A model call that fails therefore fails the whole run with the
 * cursor still at its stored value, so the retry re-asks every document instead
 * of resuming mid-way. That is the price of not windowing the fan-out, and it
 * is bounded by the batch cap rather than by the ledger's size.
 */
export async function runCategoryReclassification(
  job: ClaimedCategoryReclassificationJob,
  deps: CategoryReclassificationDependencies
): Promise<CategoryReclassificationOutcome> {
  const candidates = await resolveCandidates(job, deps);

  const groups = await deps.assignment.loadDocumentGroups({
    ledgerId: job.ledgerId,
    ledgerEntryIds: job.ledgerEntryIds,
  });

  const customPrompt =
    deps.customPrompt == null || deps.customPrompt === ""
      ? {}
      : { customPrompt: deps.customPrompt };

  const results = await Promise.all(
    groups.map(async (group) => {
      const images =
        group.storedFileIds.length === 0
          ? []
          : await deps.loadStoredFiles({
              ledgerId: job.ledgerId,
              storedFileIds: group.storedFileIds,
            });
      return deps.reclassifier.decide({ candidates, group, images, ...customPrompt });
    })
  );

  // Reduced rather than pushed into a shared array: the fan-out above settles
  // in whatever order the provider answers, and the decisions should not.
  const decisions = results.flatMap((result) => result.decisions);
  const confirmedCount =
    job.confirmedCount + results.reduce((total, result) => total + result.confirmedCount, 0);

  let appliedCount = job.appliedCount;
  if (decisions.length > 0) {
    const applied = await deps.assignment.assign({ ledgerId: job.ledgerId, decisions });
    appliedCount += applied.appliedCount;
  }

  // Nothing left to ask about is not a special case: `groups` is then empty, no
  // call is made, and the run still lands on the end of the id list.
  const cursor = job.ledgerEntryIds.length;
  const stillOwned = await deps.jobs.recordProgress({
    jobId: job.id,
    claimToken: job.claimToken,
    cursor,
    appliedCount,
    confirmedCount,
    now: deps.now,
  });
  if (!stillOwned) return { completed: false, cursor, appliedCount, confirmedCount };

  await deps.jobs.complete({
    jobId: job.id,
    claimToken: job.claimToken,
    cursor,
    appliedCount,
    confirmedCount,
    now: deps.now,
  });
  return { completed: true, cursor, appliedCount, confirmedCount };
}

async function resolveCandidates(
  job: ClaimedCategoryReclassificationJob,
  deps: CategoryReclassificationDependencies
): Promise<readonly ReclassificationCandidate[]> {
  const listed = await deps.categories.list(job.ledgerId);
  const byId = new Map(listed.map((category) => [category.id, category]));
  const candidates = job.candidateCategoryIds.flatMap((id) => {
    const category = byId.get(id);
    return category == null
      ? []
      : [{ id: category.id, name: category.name, description: category.description }];
  });

  // Fewer than two survivors leaves nothing to choose between.
  if (candidates.length < 2) {
    throw new AppError(
      "Reclassification candidates are no longer available",
      "RECLASSIFICATION_CANDIDATES_UNAVAILABLE",
      409
    );
  }
  return candidates;
}
