"use server";
import { ValidationError } from "@/lib/errors";
import { scheduleCategoryReclassificationAfter } from "@/server/category-reclassification/schedule";
import type {
  CategoryAssignmentCandidateSnapshot,
  CategoryAssignmentMode,
  CategoryReclassificationJobDto,
  StartCategoryAssignmentInput,
} from "@/modules/ledger/contracts";
import {
  parseCancelCategoryAssignmentInput,
  parseRetryCategoryAssignmentInput,
  parseStartCategoryAssignmentInput,
} from "../contract-schemas";
import { toCategoryReclassificationJobDto } from "@/modules/ledger/server/category-reclassification-job-dto";
import { withLedgerAccess } from "../access";
import { listCategories } from "../server/categories";
import { getLedgerSettings } from "../server/settings";
import {
  cancelCategoryAssignment,
  resolveLatestConflictSelection,
  retryCategoryAssignmentFailures,
  startCategoryAssignment,
} from "@/server/category-reclassification/assignments";
import { getCategoryReclassificationJob } from "@/server/category-reclassification/jobs";

async function validateMode(
  ledgerId: string,
  mode: CategoryAssignmentMode
): Promise<CategoryAssignmentCandidateSnapshot[]> {
  const categories = await listCategories(ledgerId);
  const byId = new Map(categories.map((category) => [category.id, category]));
  const ids =
    mode.kind === "ai"
      ? mode.candidateCategoryIds
      : mode.kind === "assign"
        ? [mode.categoryId]
        : [];
  if (!ids.every((id) => byId.has(id))) {
    throw new ValidationError("Category assignment categories must belong to this ledger");
  }
  return mode.kind === "ai"
    ? ids.map((id) => {
        const category = byId.get(id)!;
        return { id: category.id, name: category.name, description: category.description };
      })
    : [];
}

async function loadJob(ledgerId: string, jobId: string): Promise<CategoryReclassificationJobDto> {
  const job = await getCategoryReclassificationJob({ ledgerId, jobId });
  if (job == null) throw new ValidationError("Category assignment job was not found");
  return toCategoryReclassificationJobDto(job);
}

async function start(
  ledgerId: string,
  input: StartCategoryAssignmentInput,
  parentJobId?: string
): Promise<CategoryReclassificationJobDto> {
  const candidates = await validateMode(ledgerId, input.mode);
  const settings = await getLedgerSettings(ledgerId);
  const job = await startCategoryAssignment({
    ledgerId,
    requestKey: input.requestKey,
    mode: input.mode,
    ledgerEntryIds: input.ledgerEntryIds,
    candidates,
    customPrompt: settings?.aiCustomPrompt || null,
    ...(parentJobId == null ? {} : { parentJobId }),
  });
  scheduleCategoryReclassificationAfter(job.id, ledgerId);
  return loadJob(ledgerId, job.id);
}

/**
 * Starts a run over the selected entries in one call; replaying the same
 * request key returns the run it started.
 */
export const startCategoryAssignmentAction = withLedgerAccess(
  async (ledgerId: string, input: StartCategoryAssignmentInput) =>
    start(ledgerId, parseStartCategoryAssignmentInput(input))
);

export const cancelCategoryAssignmentAction = withLedgerAccess(
  async (ledgerId: string, input: { jobId: string }) => {
    const validated = parseCancelCategoryAssignmentInput(input);
    await cancelCategoryAssignment({ ledgerId, jobId: validated.jobId });
    return loadJob(ledgerId, validated.jobId);
  }
);

export const retryCategoryAssignmentFailuresAction = withLedgerAccess(
  async (ledgerId: string, input: { jobId: string; requestKey: string }) => {
    const validated = parseRetryCategoryAssignmentInput(input);
    const retry = await retryCategoryAssignmentFailures({
      ledgerId,
      ...validated,
    });
    scheduleCategoryReclassificationAfter(retry.id, ledgerId);
    return loadJob(ledgerId, retry.id);
  }
);

export const retryCategoryAssignmentLatestAction = withLedgerAccess(
  async (ledgerId: string, input: { jobId: string; requestKey: string }) => {
    const validated = parseRetryCategoryAssignmentInput(input);
    const latest = await resolveLatestConflictSelection({
      ledgerId,
      jobId: validated.jobId,
    });
    return start(
      ledgerId,
      {
        requestKey: validated.requestKey,
        mode: latest.mode,
        ledgerEntryIds: latest.ledgerEntryIds,
      },
      latest.parentJobId
    );
  }
);
