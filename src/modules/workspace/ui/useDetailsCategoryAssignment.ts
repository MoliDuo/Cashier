"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { invalidateLedgerQueries } from "@/lib/mutations/ledger-invalidation";
import { queryKeys } from "@/lib/query-keys";
import { getCategoryReclassificationJobAction } from "@/lib/queries/ledger-query-client";
import {
  appendCategoryAssignmentSelectionAction,
  beginCategoryAssignmentAction,
  commitCategoryAssignmentSelectionAction,
} from "@/modules/ledger/server-actions/reclassification";
import { resolveBatchCategoryPick } from "@/modules/ledger/ui/batch-action-toolbar";
import type {
  CategoryAssignmentMode,
  CategoryAssignmentSelectionEntry,
  CategoryReclassificationJob,
  EntryCategory,
  LedgerEntry,
} from "@/modules/ledger/contracts";
import { selectionMatches } from "./selection-snapshot";

/** One pick is written through as-is; a longer selection is uploaded in chunks. */
const DIRECT_ASSIGNMENT_LIMIT = 100;
const SELECTION_CHUNK_SIZE = 1000;

/**
 * A run takes a couple of minutes over up to 100 entries, so the default
 * polling schedule — five rounds, about three and a half minutes — would be
 * spent before a slow run finished. The index advances on every response,
 * not only on a change, so the tail has to be long enough to outlast the run.
 */
function isReclassificationActive(job: CategoryReclassificationJob): boolean {
  return job.status === "preparing" || job.status === "pending" || job.status === "running";
}

/** The selection the open dialog is asking about, fixed at the moment it opened. */
interface CategorySnapshot {
  ledgerId: string;
  queryFingerprint: string;
  categorySignature: string;
  entries: CategoryAssignmentSelectionEntry[];
}

interface UseDetailsCategoryAssignmentOptions {
  ledgerId: string;
  queryFingerprint: string;
  categories: readonly EntryCategory[];
  entryById: ReadonlyMap<string, LedgerEntry>;
  selectedIds: readonly string[];
  clearSelection: () => void;
  /** The plain entry update this dialog writes through for a single answer. */
  assignCategory: (categoryId: string | null) => Promise<unknown>;
  isAssigningCategory: boolean;
}

/**
 * Owns the whole lifecycle of a category assignment asked from the batch
 * toolbar: the dialog and its picks, the selection it was opened on, the
 * persistent run it may start, and the completion notice that run reports
 * later. A run outlives the dialog, so none of it may live in the dialog's
 * open/closed state.
 */
export function useDetailsCategoryAssignment({
  ledgerId,
  queryFingerprint,
  categories,
  entryById,
  selectedIds,
  clearSelection,
  assignCategory,
  isAssigningCategory,
}: UseDetailsCategoryAssignmentOptions) {
  const tBatch = useTranslations("BatchActions");
  const tCommon = useTranslations("Common");
  const queryClient = useQueryClient();
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [pickedCategoryIds, setPickedCategoryIds] = useState<string[]>([]);
  const [clearCategoryPicked, setClearCategoryPicked] = useState(false);
  // Captured when the dialog opens. There is no server preview to ask for, so
  // the task row's ledger entry ids are the authority from the moment it is
  // written; the snapshot only has to survive the trip from open to confirm.
  const [categorySnapshot, setCategorySnapshot] = useState<CategorySnapshot | null>(null);
  const [selectionUploadProgress, setSelectionUploadProgress] = useState<{
    received: number;
    total: number;
  } | null>(null);
  const categoryRequestKeyRef = useRef<string | null>(null);
  const announcedJobRef = useRef<string | null>(null);
  const announcedJobsRef = useRef(new Set<string>());

  const reclassification = useQuery<CategoryReclassificationJob | null>({
    queryKey: queryKeys.categoryReclassification(ledgerId),
    queryFn: () => getCategoryReclassificationJobAction(ledgerId),
    refetchInterval: (query) =>
      query.state.data != null && isReclassificationActive(query.state.data) ? 3_000 : false,
  });
  const reclassificationJob = reclassification.data ?? null;
  const isReclassifying =
    reclassificationJob != null && isReclassificationActive(reclassificationJob);
  const categorySelectionChanged =
    categorySnapshot != null &&
    (categorySnapshot.ledgerId !== ledgerId ||
      categorySnapshot.queryFingerprint !== queryFingerprint ||
      categorySnapshot.categorySignature !== categories.map((category) => category.id).join(":") ||
      !selectionMatches(
        categorySnapshot.entries.map((entry) => entry.ledgerEntryId),
        selectedIds
      ));

  // Announce a finished run only if this client watched it run. A terminal job
  // left over from an earlier visit is history, not news — but a run this page
  // picked up mid-flight (a reload) is watched from the first poll onwards.
  useEffect(() => {
    const job = reclassificationJob;
    if (job == null) return;
    if (isReclassifying) {
      announcedJobRef.current = job.id;
      return;
    }
    if (announcedJobRef.current !== job.id || announcedJobsRef.current.has(job.id)) return;
    announcedJobsRef.current.add(job.id);
    if (job.status === "succeeded") {
      toast.success(
        tBatch("aiCategoryDone", {
          applied: job.appliedCount,
          confirmed: job.confirmedCount,
          issues: job.failedCount + job.conflictCount + job.skippedCount,
        })
      );
      void invalidateLedgerQueries(queryClient, ledgerId, ["documents", "stats"]);
      return;
    }
    toast.error(tBatch("aiCategoryFailed"));
  }, [reclassificationJob, isReclassifying, ledgerId, queryClient, tBatch]);

  // Opening captures the selection and drops the picks of the previous visit;
  // closing drops both. A snapshot that no longer matches the selection can
  // never be confirmed, so the dialog cannot promise one thing and do another.
  const setCategoryDialogVisibility = useCallback(
    (open: boolean) => {
      setCategoryDialogOpen(open);
      if (open) categoryRequestKeyRef.current = null;
      setCategorySnapshot(
        open
          ? {
              ledgerId,
              queryFingerprint,
              categorySignature: categories.map((category) => category.id).join(":"),
              entries: selectedIds.map((id) => {
                const entry = entryById.get(id);
                if (entry?.sourceDocument == null)
                  throw new Error("Entry has no source document version");
                return {
                  ledgerEntryId: id,
                  sourceDocumentId: entry.sourceDocument.id,
                  expectedVersion: entry.sourceDocument.version,
                };
              }),
            }
          : null
      );
      setPickedCategoryIds([]);
      setClearCategoryPicked(false);
    },
    [categories, entryById, ledgerId, queryFingerprint, selectedIds]
  );

  // Clearing is exclusive: "no category" is not one more candidate to weigh
  // against the others, it is the other answer to the same question.
  const toggleCategoryPick = useCallback((categoryId: string | null, picked: boolean) => {
    if (categoryId == null) {
      setClearCategoryPicked(picked);
      if (picked) setPickedCategoryIds([]);
      return;
    }
    setPickedCategoryIds((current) =>
      picked
        ? current.includes(categoryId)
          ? current
          : [...current, categoryId]
        : current.filter((id) => id !== categoryId)
    );
    if (picked) setClearCategoryPicked(false);
  }, []);

  const startAiCategory = useLedgerMutation<
    CategoryReclassificationJob,
    {
      requestKey: string;
      mode: CategoryAssignmentMode;
      entries: CategoryAssignmentSelectionEntry[];
    }
  >(ledgerId, {
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: async (input) => {
      const started = await beginCategoryAssignmentAction(ledgerId, {
        requestKey: input.requestKey,
        mode: input.mode,
        expectedEntryCount: input.entries.length,
      });
      setSelectionUploadProgress({ received: started.receivedCount, total: input.entries.length });
      for (
        let offset = started.receivedCount,
          chunkIndex = Math.floor(started.receivedCount / SELECTION_CHUNK_SIZE);
        offset < input.entries.length;
        offset += SELECTION_CHUNK_SIZE, chunkIndex += 1
      ) {
        const progress = await appendCategoryAssignmentSelectionAction(ledgerId, {
          jobId: started.id,
          chunkIndex,
          entries: input.entries.slice(offset, offset + SELECTION_CHUNK_SIZE),
        });
        setSelectionUploadProgress({ received: progress.received, total: input.entries.length });
      }
      return commitCategoryAssignmentSelectionAction(ledgerId, {
        jobId: started.id,
        expectedEntryCount: input.entries.length,
      });
    },
    invalidationErrorMessage: tCommon("savedRefreshFailed"),
    errorMessage: tBatch("aiCategoryFailed"),
    onSuccess: (job) => {
      // Watch this run even if its first poll already reports it finished.
      announcedJobRef.current = job.id;
      toast.success(tBatch("aiCategoryRunning"));
      clearSelection();
      setSelectionUploadProgress(null);
      categoryRequestKeyRef.current = null;
      setCategoryDialogVisibility(false);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.categoryReclassification(ledgerId),
      });
    },
    onError: (error) => {
      if (error instanceof Error && error.message.includes("CONFLICT")) {
        toast.error(tBatch("aiCategoryBusy"));
      }
    },
  });

  /**
   * One pick is the user's own answer and is written directly; several are a
   * question for the model. Which of the two it is comes from the same resolver
   * the dialog's summary reads, so the button cannot promise one thing and do
   * another.
   *
   * The manual write leaves the dialog open when it fails — the pick is still
   * on screen to retry — while the run closes it, because the run outlives the
   * dialog and reports itself.
   */
  const confirmCategory = useCallback(() => {
    const snapshot = categorySnapshot;
    if (snapshot == null || snapshot.entries.length === 0) return;
    if (categorySelectionChanged) {
      toast.error(tBatch("selectionMoved"));
      return;
    }

    const pick = resolveBatchCategoryPick({
      categoryIds: pickedCategoryIds,
      clearPicked: clearCategoryPicked,
    });
    if (
      (pick.kind === "clear" || pick.kind === "assign") &&
      snapshot.entries.length <= DIRECT_ASSIGNMENT_LIMIT
    ) {
      void assignCategory(pick.kind === "clear" ? null : pick.categoryId).then(
        () => setCategoryDialogVisibility(false),
        () => undefined
      );
      return;
    }
    if (pick.kind === "ai" || pick.kind === "assign" || pick.kind === "clear") {
      startAiCategory.mutate({
        requestKey: (categoryRequestKeyRef.current ??= crypto.randomUUID()),
        entries: snapshot.entries,
        mode:
          pick.kind === "ai"
            ? { kind: "ai", candidateCategoryIds: [...pick.categoryIds] }
            : pick.kind === "assign"
              ? { kind: "assign", categoryId: pick.categoryId }
              : { kind: "clear" },
      });
    }
  }, [
    assignCategory,
    categorySelectionChanged,
    categorySnapshot,
    clearCategoryPicked,
    pickedCategoryIds,
    setCategoryDialogVisibility,
    startAiCategory,
    tBatch,
  ]);

  return {
    categoryDialogOpen,
    setCategoryDialogOpen: setCategoryDialogVisibility,
    pickedCategoryIds,
    clearCategoryPicked,
    toggleCategoryPick,
    categorySelectionChanged,
    confirmCategory,
    isConfirmingCategory: isAssigningCategory || startAiCategory.isPending,
    isStartingCategory: startAiCategory.isPending,
    reclassificationJob,
    isReclassifying,
    selectionUploadProgress,
  };
}
