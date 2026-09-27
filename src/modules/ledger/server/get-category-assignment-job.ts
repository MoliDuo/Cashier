import { withLedgerAccess } from "../access";
import type { CategoryAssignmentJobDto } from "@/modules/ledger/contracts";
import { toCategoryAssignmentJobDto } from "@/modules/ledger/server/category-assignment-job-dto";
import type { CategoryAssignmentResultPageDto } from "@/modules/ledger/contracts";
import { listCategoryAssignmentResults } from "@/server/category-assignment/assignments";
import { getLatestCategoryAssignmentJob } from "@/server/category-assignment/jobs";

/**
 * The ledger's most recent run, running or finished. Read through the session
 * query route rather than the action queue, which is why it lives here rather
 * than beside the start action.
 */
export const getCategoryAssignmentJobAction = withLedgerAccess(
  async (ledgerId: string): Promise<CategoryAssignmentJobDto | null> => {
    const job = await getLatestCategoryAssignmentJob({ ledgerId });
    return job == null ? null : toCategoryAssignmentJobDto(job);
  }
);

export const getCategoryAssignmentResultsAction = withLedgerAccess(
  async (
    ledgerId: string,
    input: { jobId: string; cursor?: number; limit?: number }
  ): Promise<CategoryAssignmentResultPageDto> =>
    listCategoryAssignmentResults({ ledgerId, ...input })
);
