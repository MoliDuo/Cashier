import type { CategoryPort } from "@/application/contracts";
import { AppError } from "@/lib/errors";
import type {
  CategoryReclassificationJobPort,
  ClaimedCategoryReclassificationJob,
  EntryCategoryAssignmentPort,
  EntryReclassifierPort,
} from "../ports";
import type { ReclassificationCandidate } from "../reclassification-protocol";

/** Entries per model call. Small enough to stay well inside one response. */
export const RECLASSIFICATION_SLICE_SIZE = 20;

export interface CategoryReclassificationDependencies {
  jobs: CategoryReclassificationJobPort;
  assignment: EntryCategoryAssignmentPort;
  reclassifier: EntryReclassifierPort;
  categories: Pick<CategoryPort, "list">;
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
 * Walk a claimed run from its stored cursor, one slice at a time.
 *
 * The candidate list is resolved once, before the first model call, and reused
 * for every slice. Its order is the index base the model answers in, so letting
 * it shift between slices would silently remap later answers onto the wrong
 * categories. A candidate deleted mid-run therefore does not renumber
 * anything: `assign` simply stops matching it.
 *
 * The model call happens outside any transaction or ledger lock. Progress is
 * recorded only after a slice is applied, so an error leaves the cursor before
 * the failing slice and a retry resumes there instead of paying for the
 * already-applied prefix again.
 */
export async function runCategoryReclassification(
  job: ClaimedCategoryReclassificationJob,
  deps: CategoryReclassificationDependencies
): Promise<CategoryReclassificationOutcome> {
  const candidates = await resolveCandidates(job, deps);

  let cursor = job.cursor;
  let appliedCount = job.appliedCount;
  let confirmedCount = job.confirmedCount;

  while (cursor < job.ledgerEntryIds.length) {
    const sliceIds = job.ledgerEntryIds.slice(cursor, cursor + RECLASSIFICATION_SLICE_SIZE);
    const subjects = await deps.assignment.loadSubjects({
      ledgerId: job.ledgerId,
      ledgerEntryIds: sliceIds,
    });

    if (subjects.length > 0) {
      const decided = await deps.reclassifier.decide({
        candidates,
        subjects,
        ...(deps.customPrompt == null || deps.customPrompt === ""
          ? {}
          : { customPrompt: deps.customPrompt }),
      });
      if (decided.decisions.length > 0) {
        const { appliedCount: applied } = await deps.assignment.assign({
          ledgerId: job.ledgerId,
          decisions: decided.decisions,
        });
        appliedCount += applied;
      }
      confirmedCount += decided.confirmedCount;
    }

    // Advance by the slice we asked about, not by how many of its entries are
    // still alive, so the cursor stays aligned with `ledgerEntryIds`.
    cursor += sliceIds.length;
    const stillOwned = await deps.jobs.recordProgress({
      jobId: job.id,
      claimToken: job.claimToken,
      cursor,
      appliedCount,
      confirmedCount,
      now: deps.now,
    });
    if (!stillOwned) return { completed: false, cursor, appliedCount, confirmedCount };
  }

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
