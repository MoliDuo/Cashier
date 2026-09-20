"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useSelection } from "@/hooks/use-selection";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { formatDateTimeForApi, getDateInTimezone } from "@/lib/date-utils";
import {
  batchDeleteLedgerEntriesAction,
  batchUpdateLedgerEntriesAction,
  batchUpdateLedgerEntryDatesAction,
  previewBatchLedgerEntryDateAction,
} from "@/modules/ledger/server-actions/entries";
import type { EntryCategory, LedgerEntry } from "@/modules/ledger/contracts";
import type { VersionedTarget } from "@/modules/source-document/contracts";
import { unwrapAtomicBatchCommandResult } from "@/modules/source-document/command-results";
import { useDetailsCategoryAssignment } from "./useDetailsCategoryAssignment";
import { selectionMatches } from "./selection-snapshot";

type BatchDateImpact = Awaited<ReturnType<typeof previewBatchLedgerEntryDateAction>>;

/** The selection a date preview answered for, kept so confirmation can use it. */
interface DatePreviewRequest {
  entryIds: string[];
  targets: VersionedTarget[];
  queryFingerprint: string;
  impact: BatchDateImpact;
}

/**
 * The date dialog has one source of truth: what it is currently showing.
 * Closed, waiting for the preview, failed to compute it, or holding the
 * result — with the impact and the selection it describes kept together, so a
 * result can never be confirmed against a different selection.
 */
type DatePreviewState =
  | { status: "closed" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; request: DatePreviewRequest };

export function useDetailsBatchController(
  ledgerId: string,
  entries: readonly LedgerEntry[],
  queryFingerprint: string,
  timeZone?: string,
  categories: readonly EntryCategory[] = []
) {
  const t = useTranslations("DetailsTab");
  const tBatch = useTranslations("BatchActions");
  const tCommon = useTranslations("Common");
  const allIds = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const targetsFor = useCallback(
    (ids: readonly string[]): VersionedTarget[] => {
      const versions = new Map<string, number>();
      for (const id of ids) {
        const sourceDocument = entryById.get(id)?.sourceDocument;
        if (sourceDocument == null) throw new Error("Entry has no source document version");
        const previous = versions.get(sourceDocument.id);
        if (previous != null && previous !== sourceDocument.version) {
          throw new Error("Selected entries contain conflicting source document versions");
        }
        versions.set(sourceDocument.id, sourceDocument.version);
      }
      return [...versions]
        .map(([sourceDocumentId, expectedVersion]) => ({ sourceDocumentId, expectedVersion }))
        .sort((left, right) => left.sourceDocumentId.localeCompare(right.sourceDocumentId));
    },
    [entryById]
  );
  const selection = useSelection({ allIds, queryFingerprint, maxSelected: null });
  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    () => getDateInTimezone(timeZone) ?? formatDateTimeForApi(new Date())
  );
  const [datePreview, setDatePreview] = useState<DatePreviewState>({ status: "closed" });
  const dateRequestIdRef = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.batchSelection = String(selection.isSelectionMode);
    return () => {
      delete document.documentElement.dataset.batchSelection;
    };
  }, [selection.isSelectionMode]);

  const update = useLedgerMutation<
    { ledgerEntryIds: string[]; affectedCount: number },
    { categoryId?: string | null; currency?: string | null }
  >(ledgerId, {
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: async (data: { categoryId?: string | null; currency?: string | null }) => {
      const result = await batchUpdateLedgerEntriesAction(
        ledgerId,
        targetsFor(selection.selectedIds),
        selection.selectedIds,
        data
      );
      return unwrapAtomicBatchCommandResult(result);
    },
    invalidationErrorMessage: tCommon("savedRefreshFailed"),
    errorMessage: tCommon("error"),
    onSuccess: (result) => {
      if (result.affectedCount > 0)
        toast.success(t("batchUpdated", { count: result.affectedCount }));
      selection.clearSelection();
    },
  });

  const categoryAssignment = useDetailsCategoryAssignment({
    ledgerId,
    queryFingerprint,
    categories,
    entryById,
    selectedIds: selection.selectedIds,
    clearSelection: selection.clearSelection,
    assignCategory: (categoryId) => update.mutateAsync({ categoryId }),
    isAssigningCategory: update.isPending,
  });

  const remove = useLedgerMutation<
    Awaited<ReturnType<typeof batchDeleteLedgerEntriesAction>>,
    void
  >(ledgerId, {
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: () =>
      batchDeleteLedgerEntriesAction(
        ledgerId,
        targetsFor(selection.selectedIds),
        selection.selectedIds
      ),
    invalidationErrorMessage: tCommon("savedRefreshFailed"),
    errorMessage: tCommon("deleteFailed"),
    onSuccess: (result) => {
      const unresolved = [...result.stale, ...result.failed].map((item) => item.id);
      if (unresolved.length === 0) setDeleteDialogOpen(false);
      if (unresolved.length > 0) selection.retainSelection(unresolved);
      else selection.clearSelection();
      if (result.succeeded.length > 0)
        toast.success(t("batchDeleted", { count: result.succeeded.length }));
      if (unresolved.length > 0) toast.warning(t("batchUnresolved", { count: unresolved.length }));
    },
  });

  /**
   * Asks for the impact of the selection as it stands right now. The request
   * number is taken before the call and every open, retry or close supersedes
   * it, so an answer that arrives late — out of order, or after the dialog was
   * reopened on something else — is dropped instead of overwriting the current
   * one. A preview never describes a selection it was not asked about.
   */
  const startDatePreview = useCallback(() => {
    const requestId = ++dateRequestIdRef.current;
    const entryIds = [...selection.selectedIds];
    const capturedFingerprint = queryFingerprint;
    setDatePreview({ status: "loading" });
    void (async () => {
      let impact: BatchDateImpact;
      let targets: VersionedTarget[];
      try {
        impact = await previewBatchLedgerEntryDateAction(ledgerId, entryIds);
        targets = targetsFor(entryIds);
      } catch {
        if (dateRequestIdRef.current === requestId) setDatePreview({ status: "error" });
        return;
      }
      if (dateRequestIdRef.current !== requestId) return;
      setDatePreview({
        status: "ready",
        request: { entryIds, targets, queryFingerprint: capturedFingerprint, impact },
      });
    })();
  }, [ledgerId, queryFingerprint, selection.selectedIds, targetsFor]);

  const setDateDialogVisibility = useCallback((open: boolean) => {
    dateRequestIdRef.current += 1;
    setDateDialogOpen(open);
    setDatePreview({ status: "closed" });
  }, []);

  // The dialog opens on the day the user is about to set and fills in what the
  // change touches, instead of asking for the day first and the impact after.
  const openDateDialog = useCallback(() => {
    setDateDialogVisibility(true);
    startDatePreview();
  }, [setDateDialogVisibility, startDatePreview]);

  const retryDatePreview = startDatePreview;

  // A preview answered for one book says nothing about the next one, and a
  // request still in flight when the screen goes away has nowhere to land.
  useEffect(() => {
    return () => {
      dateRequestIdRef.current += 1;
    };
  }, [ledgerId]);

  // The preview is answered for a snapshot of the selection, so a selection
  // that moved since then is no longer what the dialog describes.
  const dateSelectionChanged =
    datePreview.status === "ready" &&
    (datePreview.request.queryFingerprint !== queryFingerprint ||
      !selectionMatches(datePreview.request.entryIds, selection.selectedIds));
  const dateImpact = datePreview.status === "ready" ? datePreview.request.impact : null;
  const datePreviewFailed = datePreview.status === "error";
  const isPreviewingDate = datePreview.status === "loading";

  const updateDates = useLedgerMutation<{ impact: BatchDateImpact }, void>(ledgerId, {
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: async () => {
      if (datePreview.status !== "ready") throw new Error("selection_changed");
      const { request } = datePreview;
      if (
        request.queryFingerprint !== queryFingerprint ||
        !selectionMatches(request.entryIds, selection.selectedIds)
      ) {
        throw new Error("selection_changed");
      }
      const result = await batchUpdateLedgerEntryDatesAction(
        ledgerId,
        request.targets,
        request.entryIds,
        selectedDate
      );
      return unwrapAtomicBatchCommandResult(result);
    },
    invalidationErrorMessage: tCommon("savedRefreshFailed"),
    errorMessage: tBatch("selectionChanged"),
    onSuccess: (result) => {
      toast.success(tBatch("datesUpdated", { count: result.impact.affectedEntryCount }));
      selection.clearSelection();
      setDateDialogVisibility(false);
    },
  });

  return {
    ...selection,
    dateDialogOpen,
    setDateDialogOpen: setDateDialogVisibility,
    openDateDialog,
    datePreviewFailed,
    dateSelectionChanged,
    retryDatePreview,
    isPreviewingDate,
    deleteDialogOpen,
    setDeleteDialogOpen,
    selectedDate,
    setSelectedDate,
    timeZone,
    dateImpact,
    update,
    remove,
    updateDates,
    categoryDialogOpen: categoryAssignment.categoryDialogOpen,
    setCategoryDialogOpen: categoryAssignment.setCategoryDialogOpen,
    pickedCategoryIds: categoryAssignment.pickedCategoryIds,
    clearCategoryPicked: categoryAssignment.clearCategoryPicked,
    toggleCategoryPick: categoryAssignment.toggleCategoryPick,
    categorySelectionChanged: categoryAssignment.categorySelectionChanged,
    confirmCategory: categoryAssignment.confirmCategory,
    reclassificationJob: categoryAssignment.reclassificationJob,
    selectionUploadProgress: categoryAssignment.selectionUploadProgress,
    isReclassifying: categoryAssignment.isReclassifying,
    isConfirmingCategory: categoryAssignment.isConfirmingCategory,
    isPending:
      update.isPending ||
      remove.isPending ||
      isPreviewingDate ||
      updateDates.isPending ||
      categoryAssignment.isStartingCategory,
  };
}
