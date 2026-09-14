"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useSelection } from "@/hooks/use-selection";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { invalidateLedgerQueries } from "@/lib/mutations/ledger-invalidation";
import { queryKeys } from "@/lib/query-keys";
import { getCategoryReclassificationJobAction } from "@/lib/queries/ledger-query-client";
import { formatDateTimeForApi, getDateInTimezone } from "@/lib/date-utils";
import {
  batchDeleteLedgerEntriesAction,
  batchUpdateLedgerEntriesAction,
  batchUpdateLedgerEntryDatesAction,
  previewBatchLedgerEntryDateAction,
} from "@/modules/ledger/server-actions/entries";
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
import type { VersionedTarget } from "@/modules/source-document/contracts";
import { unwrapAtomicBatchCommandResult } from "@/modules/source-document/command-results";

type BatchDateImpact = Awaited<ReturnType<typeof previewBatchLedgerEntryDateAction>>;

/**
 * A run takes a couple of minutes over up to 100 entries, so the default
 * polling schedule — five rounds, about three and a half minutes — would be
 * spent before a slow run finished. The index advances on every response,
 * not only on a change, so the tail has to be long enough to outlast the run.
 */
function selectionMatches(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function isReclassificationActive(job: CategoryReclassificationJob): boolean {
  return job.status === "preparing" || job.status === "pending" || job.status === "running";
}

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
  const [dateImpact, setDateImpact] = useState<BatchDateImpact | null>(null);
  const [datePreviewFailed, setDatePreviewFailed] = useState(false);
  const [dateSelectionSnapshot, setDateSelectionSnapshot] = useState<{
    entryIds: string[];
    targets: VersionedTarget[];
    queryFingerprint: string;
    impact: BatchDateImpact;
  } | null>(null);
  const setDateDialogVisibility = useCallback((open: boolean) => {
    setDateDialogOpen(open);
    if (!open) {
      setDateImpact(null);
      setDatePreviewFailed(false);
      setDateSelectionSnapshot(null);
    }
  }, []);
  // The preview is answered for a snapshot of the selection, so a selection
  // that moved since then is no longer what the dialog describes.
  const dateSelectionChanged =
    dateSelectionSnapshot != null &&
    (dateSelectionSnapshot.queryFingerprint !== queryFingerprint ||
      dateSelectionSnapshot.entryIds.length !== selection.selectedIds.length ||
      dateSelectionSnapshot.entryIds.some((id, index) => id !== selection.selectedIds[index]));

  const queryClient = useQueryClient();
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [pickedCategoryIds, setPickedCategoryIds] = useState<string[]>([]);
  const [clearCategoryPicked, setClearCategoryPicked] = useState(false);
  // Captured when the dialog opens. There is no server preview to ask for, so
  // the task row's `ledgerEntryIds` is the authority from the moment it is
  // written; the snapshot only has to survive the trip from open to confirm.
  const [categorySnapshot, setCategorySnapshot] = useState<{
    ledgerId: string;
    queryFingerprint: string;
    categorySignature: string;
    entries: CategoryAssignmentSelectionEntry[];
  } | null>(null);
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
        selection.selectedIds
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

  // Opening captures the selection: there is no server preview to ask for, so
  // the task row's `ledgerEntryIds` is the authority from the moment it is
  // written, and the snapshot only has to survive the trip from open to
  // confirm. Closing drops the picks with it.
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
              entries: selection.selectedIds.map((id) => {
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
    [categories, entryById, ledgerId, queryFingerprint, selection.selectedIds]
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
        let offset = started.receivedCount, chunkIndex = Math.floor(started.receivedCount / 1000);
        offset < input.entries.length;
        offset += 1000, chunkIndex += 1
      ) {
        const progress = await appendCategoryAssignmentSelectionAction(ledgerId, {
          jobId: started.id,
          chunkIndex,
          entries: input.entries.slice(offset, offset + 1000),
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
      selection.clearSelection();
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
    if ((pick.kind === "clear" || pick.kind === "assign") && snapshot.entries.length <= 100) {
      void update.mutateAsync({ categoryId: pick.kind === "clear" ? null : pick.categoryId }).then(
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
    categorySnapshot,
    categorySelectionChanged,
    clearCategoryPicked,
    pickedCategoryIds,
    setCategoryDialogVisibility,
    startAiCategory,
    tBatch,
    update,
  ]);
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
  const previewDate = useMutation({
    mutationFn: async () => {
      const snapshotEntryIds = [...selection.selectedIds];
      const impact = await previewBatchLedgerEntryDateAction(ledgerId, snapshotEntryIds);
      return { entryIds: snapshotEntryIds, targets: targetsFor(snapshotEntryIds), impact };
    },
    onSuccess: ({ entryIds: snapshotEntryIds, targets, impact }) => {
      setDateImpact(impact);
      setDateSelectionSnapshot({ entryIds: snapshotEntryIds, targets, queryFingerprint, impact });
    },
    onError: () => setDatePreviewFailed(true),
  });
  const { mutate: previewDateMutate, isPending: isPreviewingDate } = previewDate;
  // The dialog opens on the day the user is about to set and fills in what the
  // change touches, instead of asking for the day first and the impact after.
  const openDateDialog = useCallback(() => {
    setDateDialogVisibility(true);
    previewDateMutate();
  }, [previewDateMutate, setDateDialogVisibility]);
  const retryDatePreview = useCallback(() => previewDateMutate(), [previewDateMutate]);
  const updateDates = useLedgerMutation<{ impact: BatchDateImpact }, void>(ledgerId, {
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: async () => {
      const snapshot = dateSelectionSnapshot;
      if (
        snapshot == null ||
        snapshot.queryFingerprint !== queryFingerprint ||
        snapshot.entryIds.length !== selection.selectedIds.length ||
        snapshot.entryIds.some((id, index) => id !== selection.selectedIds[index])
      ) {
        throw new Error("selection_changed");
      }
      const result = await batchUpdateLedgerEntryDatesAction(
        ledgerId,
        snapshot.targets,
        snapshot.entryIds,
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
    dateSelectionSnapshot,
    update,
    remove,
    previewDate,
    updateDates,
    categoryDialogOpen,
    setCategoryDialogOpen: setCategoryDialogVisibility,
    pickedCategoryIds,
    clearCategoryPicked,
    toggleCategoryPick,
    categorySelectionChanged,
    confirmCategory,
    startAiCategory,
    reclassificationJob,
    selectionUploadProgress,
    isReclassifying,
    isConfirmingCategory: update.isPending || startAiCategory.isPending,
    isPending:
      update.isPending ||
      remove.isPending ||
      previewDate.isPending ||
      updateDates.isPending ||
      startAiCategory.isPending,
  };
}
