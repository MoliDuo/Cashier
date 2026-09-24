"use server";
import { ValidationError } from "@/lib/errors";
import { scheduleCategoryReclassificationAfter } from "@/server/category-reclassification/schedule";
import type {
  AppendCategoryAssignmentSelectionInput,
  BeginCategoryAssignmentInput,
  CategoryAssignmentCandidateSnapshot,
  CategoryAssignmentMode,
  CategoryReclassificationJobDto,
  CommitCategoryAssignmentSelectionInput,
} from "@/modules/ledger/contracts";
import {
  parseAppendCategoryAssignmentSelectionInput,
  parseBeginCategoryAssignmentInput,
  parseCancelCategoryAssignmentInput,
  parseCommitCategoryAssignmentSelectionInput,
  parseRetryCategoryAssignmentInput,
} from "../contract-schemas";
import { toCategoryReclassificationJobDto } from "../application/queries/category-reclassification-job-dto";
import { withLedgerAccess } from "../access";
import { listCategories } from "../server/categories";
import { getLedgerSettings } from "../server/settings";
import {
  appendCategoryAssignmentEntries,
  beginCategoryAssignment,
  cancelCategoryAssignment,
  commitCategoryAssignment,
  getCategoryAssignmentProgress,
  resolveLatestConflictSelection,
  retryCategoryAssignmentFailures,
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
  const metrics = await getCategoryAssignmentProgress({
    ledgerId,
    jobId,
  });
  return toCategoryReclassificationJobDto(job, metrics);
}

async function begin(
  ledgerId: string,
  input: BeginCategoryAssignmentInput,
  parentJobId?: string
): Promise<CategoryReclassificationJobDto> {
  const candidates = await validateMode(ledgerId, input.mode);
  const settings = await getLedgerSettings(ledgerId);
  const job = await beginCategoryAssignment({
    ledgerId,
    requestKey: input.requestKey,
    mode: input.mode,
    expectedEntryCount: input.expectedEntryCount,
    candidates,
    customPrompt: settings?.aiCustomPrompt || null,
    ...(parentJobId == null ? {} : { parentJobId }),
  });
  return loadJob(ledgerId, job.id);
}

export const beginCategoryAssignmentAction = withLedgerAccess(
  async (ledgerId: string, input: BeginCategoryAssignmentInput) =>
    begin(ledgerId, parseBeginCategoryAssignmentInput(input))
);

export const appendCategoryAssignmentSelectionAction = withLedgerAccess(
  async (ledgerId: string, input: AppendCategoryAssignmentSelectionInput) => {
    const validated = parseAppendCategoryAssignmentSelectionInput(input);
    const progress = await appendCategoryAssignmentEntries({ ledgerId, ...validated });
    return { jobId: validated.jobId, received: progress.receivedEntryCount };
  }
);

export const commitCategoryAssignmentSelectionAction = withLedgerAccess(
  async (ledgerId: string, input: CommitCategoryAssignmentSelectionInput) => {
    const validated = parseCommitCategoryAssignmentSelectionInput(input);
    const committed = await commitCategoryAssignment({
      ledgerId,
      ...validated,
    });
    scheduleCategoryReclassificationAfter(committed.id, ledgerId);
    return loadJob(ledgerId, committed.id);
  }
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
    const started = await begin(
      ledgerId,
      {
        requestKey: validated.requestKey,
        mode: latest.mode,
        expectedEntryCount: latest.entries.length,
      },
      latest.parentJobId
    );
    for (let offset = 0, chunkIndex = 0; offset < latest.entries.length; offset += 1000) {
      await appendCategoryAssignmentEntries({
        ledgerId,
        jobId: started.id,
        chunkIndex,
        entries: latest.entries.slice(offset, offset + 1000),
      });
      chunkIndex += 1;
    }
    const committed = await commitCategoryAssignment({
      ledgerId,
      jobId: started.id,
      expectedEntryCount: latest.entries.length,
    });
    scheduleCategoryReclassificationAfter(committed.id, ledgerId);
    return loadJob(ledgerId, committed.id);
  }
);
