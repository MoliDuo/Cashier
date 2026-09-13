import { withLedgerAccess } from "../access";
import { serverComposition } from "@/application/server-composition-root";
import type { CategoryReclassificationJobDto } from "@/modules/ledger/contracts";
import { toCategoryReclassificationJobDto } from "../application/queries/category-reclassification-job-dto";

/**
 * The ledger's most recent run, running or finished. Read through the session
 * query route rather than the action queue, which is why it lives here rather
 * than beside the start action.
 */
export const getCategoryReclassificationJobAction = withLedgerAccess(
  async (ledgerId: string): Promise<CategoryReclassificationJobDto | null> => {
    const job = await serverComposition.categoryReclassificationJobs.getLatest({ ledgerId });
    return job == null ? null : toCategoryReclassificationJobDto(job);
  }
);
