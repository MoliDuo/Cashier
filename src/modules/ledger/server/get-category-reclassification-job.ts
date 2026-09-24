import { withLedgerAccess } from "../access";
import type { CategoryReclassificationJobDto } from "@/modules/ledger/contracts";
import { toCategoryReclassificationJobDto } from "@/modules/ledger/server/category-reclassification-job-dto";
import type { CategoryAssignmentResultPageDto } from "@/modules/ledger/contracts";
import {
  getCategoryAssignmentProgress,
  listCategoryAssignmentResults,
} from "@/server/category-reclassification/assignments";
import { getLatestCategoryReclassificationJob } from "@/server/category-reclassification/jobs";

/**
 * The ledger's most recent run, running or finished. Read through the session
 * query route rather than the action queue, which is why it lives here rather
 * than beside the start action.
 */
export const getCategoryReclassificationJobAction = withLedgerAccess(
  async (ledgerId: string): Promise<CategoryReclassificationJobDto | null> => {
    const job = await getLatestCategoryReclassificationJob({ ledgerId });
    if (job == null) return null;
    const metrics = await getCategoryAssignmentProgress({
      ledgerId,
      jobId: job.id,
    });
    return toCategoryReclassificationJobDto(job, metrics);
  }
);

export const getCategoryAssignmentResultsAction = withLedgerAccess(
  async (
    ledgerId: string,
    input: { jobId: string; cursor?: number; limit?: number }
  ): Promise<CategoryAssignmentResultPageDto> =>
    listCategoryAssignmentResults({ ledgerId, ...input })
);
