"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { startCategoryAssignmentAction } from "@/modules/ledger/server-actions/reclassification";
import { resolveBatchCategoryPick } from "@/modules/ledger/ui/batch-action-toolbar";
import { CATEGORY_ASSIGNMENT_MAX_ENTRIES } from "@/config/tuning";
import type {
  CategoryAssignmentMode,
  CategoryReclassificationJob,
  EntryCategory,
} from "@/modules/ledger/contracts";
import { useCategoryAssignment } from "@/modules/ledger/ui/category-assignment-context";
import { selectionMatches } from "./selection-snapshot";

/** One pick is written through as-is up to this many entries; more start a run. */
const DIRECT_ASSIGNMENT_LIMIT = 100;

/** The selection the open dialog is asking about, fixed at the moment it opened. */
interface CategorySnapshot {
  queryFingerprint: string;
  categorySignature: string;
  ledgerEntryIds: string[];
}

interface UseDetailsCategoryAssignmentOptions {
  queryFingerprint: string;
  categories: readonly EntryCategory[];
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
  queryFingerprint,
  categories,
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
  const categoryRequestKeyRef = useRef<string | null>(null);
  // The run outlives this tab, so the page follows it and this dialog only hands
  // it over: nothing here polls, and nothing here announces what the page began.
  const { registerSubmittedJob } = useCategoryAssignment();
  const categorySelectionChanged =
    categorySnapshot != null &&
    (categorySnapshot.queryFingerprint !== queryFingerprint ||
      categorySnapshot.categorySignature !== categories.map((category) => category.id).join(":") ||
      !selectionMatches(categorySnapshot.ledgerEntryIds, selectedIds));

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
              queryFingerprint,
              categorySignature: categories.map((category) => category.id).join(":"),
              ledgerEntryIds: [...selectedIds],
            }
          : null
      );
      setPickedCategoryIds([]);
      setClearCategoryPicked(false);
    },
    [categories, queryFingerprint, selectedIds]
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
      ledgerEntryIds: string[];
    }
  >({
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: (input) => startCategoryAssignmentAction(input),
    errorMessage: tBatch("aiCategoryFailed"),
    onSuccess: (job) => {
      // Hand the run to the page before it can finish: a run whose first answer
      // already reports it over still has to say so, once, to this reader.
      registerSubmittedJob(job);
      toast.success(tBatch("aiCategoryRunning"));
      clearSelection();
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
    if (snapshot == null || snapshot.ledgerEntryIds.length === 0) return;
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
      snapshot.ledgerEntryIds.length <= DIRECT_ASSIGNMENT_LIMIT
    ) {
      void assignCategory(pick.kind === "clear" ? null : pick.categoryId).then(
        () => setCategoryDialogVisibility(false),
        () => undefined
      );
      return;
    }
    if (pick.kind === "ai" || pick.kind === "assign" || pick.kind === "clear") {
      if (snapshot.ledgerEntryIds.length > CATEGORY_ASSIGNMENT_MAX_ENTRIES) {
        toast.error(tBatch("categorySelectionTooLarge", { max: CATEGORY_ASSIGNMENT_MAX_ENTRIES }));
        return;
      }
      startAiCategory.mutate({
        requestKey: (categoryRequestKeyRef.current ??= crypto.randomUUID()),
        ledgerEntryIds: snapshot.ledgerEntryIds,
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
  };
}
