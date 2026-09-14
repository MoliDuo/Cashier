import type { CategoryReclassificationJob } from "@/modules/ledger/contracts";

const ACTIVE_CATEGORY_ASSIGNMENT_STATUSES = new Set(["preparing", "pending", "running"]);

/**
 * The single test for "this run is still moving". The status band, the polling
 * schedule, and the settings warning all ask the same question, so they read
 * the same answer instead of each carrying their own status list.
 */
export function isCategoryAssignmentJobActive(job: CategoryReclassificationJob | null): boolean {
  return job != null && ACTIVE_CATEGORY_ASSIGNMENT_STATUSES.has(job.status);
}

export interface CategoryAssignmentStatusVisibilityInput {
  job: CategoryReclassificationJob | null;
  isReadError: boolean;
  /** This page watched the run while it was active, so its result is news rather than history. */
  wasActive: boolean;
  /** The user closed the band while it described `job`. */
  dismissed: boolean;
  /** The user closed the band while it reported a read failure that had no job to describe. */
  readFailureDismissed: boolean;
}

/**
 * The band reports a run this page watched, never the ledger's most recent
 * finished run: a job loaded for the first time in a terminal status is what the
 * user already saw happen, and reprinting it on every visit is noise.
 *
 * An active run outranks a dismissal, so hiding the band can never take away the
 * progress readout and the Stop control while there is still something to stop.
 */
export function shouldShowCategoryAssignmentStatus(
  input: CategoryAssignmentStatusVisibilityInput
): boolean {
  if (isCategoryAssignmentJobActive(input.job)) return true;
  if (input.isReadError && !input.readFailureDismissed) return true;
  return input.job != null && input.wasActive && !input.dismissed;
}
