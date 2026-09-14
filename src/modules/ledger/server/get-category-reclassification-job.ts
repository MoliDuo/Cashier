import { withLedgerAccess } from "../access";
import { serverComposition } from "@/application/server-composition-root";
import type { CategoryReclassificationJobDto } from "@/modules/ledger/contracts";
import { toCategoryReclassificationJobDto } from "../application/queries/category-reclassification-job-dto";
import type { CategoryAssignmentResultPageDto } from "@/modules/ledger/contracts";

/**
 * The ledger's most recent run, running or finished. Read through the session
 * query route rather than the action queue, which is why it lives here rather
 * than beside the start action.
 */
export const getCategoryReclassificationJobAction = withLedgerAccess(
  async (ledgerId: string): Promise<CategoryReclassificationJobDto | null> => {
    const job = await serverComposition.categoryReclassificationJobs.getLatest({ ledgerId });
    if (job == null) return null;
    const metrics =
      job.formatVersion === 2
        ? await serverComposition.categoryAssignments.getProgressMetrics({
            ledgerId,
            jobId: job.id,
          })
        : undefined;
    return toCategoryReclassificationJobDto(job, metrics);
  }
);

export const getCategoryAssignmentResultsAction = withLedgerAccess(
  async (
    ledgerId: string,
    input: { jobId: string; cursor?: number; limit?: number }
  ): Promise<CategoryAssignmentResultPageDto> =>
    serverComposition.categoryAssignments.listResults({ ledgerId, ...input })
);
