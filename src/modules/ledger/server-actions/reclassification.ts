"use server";
import { ValidationError } from "@/lib/errors";
import { withLedgerAccess } from "../access";
import { parseStartCategoryReclassificationInput } from "../contract-schemas";
import type {
  CategoryReclassificationJobDto,
  StartCategoryReclassificationInput,
} from "@/modules/ledger/contracts";
import { toCategoryReclassificationJobDto } from "../application/queries/category-reclassification-job-dto";
import { serverComposition } from "@/application/server-composition-root";
import { scheduleCategoryReclassificationAfter } from "@/application/processing/schedule-category-reclassification";

/**
 * Register a run and schedule its execution. The order matters: the row is
 * committed before `after()` is registered, so a callback that fires
 * immediately still finds the run it was asked to advance.
 *
 * The candidate set is checked against the ledger's live categories here so an
 * obviously bad request fails fast. That check is not the last line of defence
 * — the assignment write re-verifies ownership per row.
 */
export const startCategoryReclassificationAction = withLedgerAccess(
  async (
    ledgerId: string,
    input: StartCategoryReclassificationInput
  ): Promise<CategoryReclassificationJobDto> => {
    const validated = parseStartCategoryReclassificationInput(input);
    const categories = await serverComposition.categories.list(ledgerId);
    const ownedIds = new Set(categories.map((category) => category.id));
    if (!validated.candidateCategoryIds.every((categoryId) => ownedIds.has(categoryId))) {
      throw new ValidationError("Candidate categories must belong to this ledger");
    }

    const job = await serverComposition.categoryReclassificationJobs.enqueue({
      ledgerId,
      ledgerEntryIds: validated.ledgerEntryIds,
      candidateCategoryIds: validated.candidateCategoryIds,
    });
    scheduleCategoryReclassificationAfter(job.id, ledgerId);
    return toCategoryReclassificationJobDto(job);
  }
);
