"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
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
import { useCategoryAssignment } from "@/modules/ledger/ui/category-assignment-context";
import { selectionMatches } from "./selection-snapshot";

/** One pick is written through as-is; a longer selection is uploaded in chunks. */
const DIRECT_ASSIGNMENT_LIMIT = 100;
const SELECTION_CHUNK_SIZE = 1000;

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
 * Owns the dialog of a category assignment asked from the batch toolbar: its
 * picks, the selection it was opened on, and the persistent run it may start.
 * The run itself outlives the dialog — and this tab — so the page follows it
 * through `useCategoryAssignment`, and this hook only reports back the run it
 * started.
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
  // The run outlives this tab, so the page follows it and this dialog only hands
  // it over: nothing here polls, and nothing here announces what the page began.
  const { registerSubmittedJob } = useCategoryAssignment();
  const categorySelectionChanged =
    categorySnapshot != null &&
    (categorySnapshot.ledgerId !== ledgerId ||
      categorySnapshot.queryFingerprint !== queryFingerprint ||
      categorySnapshot.categorySignature !== categories.map((category) => category.id).join(":") ||
      !selectionMatches(
        categorySnapshot.entries.map((entry) => entry.ledgerEntryId),
        selectedIds
      ));

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
    errorMessage: tBatch("aiCategoryFailed"),
    onSuccess: (job) => {
      // Hand the run to the page before it can finish: a run whose first answer
      // already reports it over still has to say so, once, to this reader.
      registerSubmittedJob(job);
      toast.success(tBatch("aiCategoryRunning"));
      clearSelection();
      setSelectionUploadProgress(null);
      categoryRequestKeyRef.current = null;
      setCategoryDialogVisibility(false);
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
    selectionUploadProgress,
  };
}
