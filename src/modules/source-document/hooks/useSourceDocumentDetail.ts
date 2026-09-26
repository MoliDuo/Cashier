"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { LEDGER, QUERY } from "@/lib/constants";
import { clearDraft, draftKey, readDraft, writeDraft } from "@/lib/drafts";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { openLedgerDetail } from "@/lib/navigation/ledger-detail-navigation";
import { queryKeys } from "@/lib/query-keys";
import { useConfirmGate } from "@/hooks/use-confirm-gate";
import { useSelection } from "@/hooks/use-selection";
import type { BookDto, LedgerEntry } from "@/modules/ledger/contracts";
import { useLedgerId } from "@/modules/ledger/hooks/useLedgerId";
import { fetchBook } from "@/modules/ledger/queries";
import {
  batchDeleteLedgerEntriesAction,
  batchUpdateLedgerEntriesAction,
  createLedgerEntryAction,
  deleteLedgerEntryAction,
} from "@/modules/ledger/server-actions/entries";
import {
  SourceDocumentStaleCommandError,
  unwrapVersionedCommandResult,
} from "@/modules/source-document/command-results";
import type {
  ApplyDateOrganizationInput,
  ApplyDateOrganizationResultDto,
  PartialBatchCommandResult,
  SaveSourceDocumentChangesResultDto,
  SourceDocument,
  SplitSourceDocumentInput,
  SplitSourceDocumentResultDto,
} from "@/modules/source-document/contracts";
import { toSaveSourceDocumentChangesInput } from "@/modules/source-document/detail-save-input";
import type {
  AddEntryData,
  PendingChanges,
  SourceDocPendingChanges,
} from "@/modules/source-document/detail-types";
import { fetchSourceDocumentDetail } from "@/modules/source-document/queries";
import { assignSourceDocumentBookAction } from "@/modules/source-document/server-actions/book";
import {
  applyDateOrganizationAction,
  dismissDateOrganizationAction,
} from "@/modules/source-document/server-actions/date-organization";
import { deleteSourceDocumentAction } from "@/modules/source-document/server-actions/delete";
import { cancelSourceDocumentProcessingAction } from "@/modules/source-document/server-actions/processing";
import { splitSourceDocumentAction } from "@/modules/source-document/server-actions/split";
import { saveSourceDocumentChangesAction } from "@/modules/source-document/server-actions/update";
import type { EntryEditData } from "@/modules/source-document/types";
import { useLedgerRefreshPolling } from "./useLedgerRefreshPolling";

const NO_ENTRIES: LedgerEntry[] = [];

/** An action that asks to save or discard pending edits before it runs. */
type DeferredAction =
  | { type: "cancel-processing" }
  | { type: "open-retry" }
  | { type: "open-delete" }
  | { type: "open-add" }
  | { type: "open-split" }
  | { type: "request-entry-delete"; entryId: string }
  | { type: "batch-delete" }
  | { type: "batch-category"; categoryId: string | null }
  | { type: "batch-currency"; currency: string };

type BatchPatch = { categoryId: string | null } | { currency: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** A stored edit is only trusted when every field is a plain value. */
function parsePendingChanges(data: unknown): PendingChanges | null {
  if (!isRecord(data) || !isRecord(data.sourceDoc) || !isRecord(data.entries)) return null;
  const isValue = (value: unknown) =>
    value === null || ["string", "number", "boolean"].includes(typeof value);
  if (!Object.values(data.sourceDoc).every((value) => typeof value === "string")) return null;
  for (const entry of Object.values(data.entries)) {
    if (!isRecord(entry) || !Object.values(entry).every(isValue)) return null;
  }
  return data as unknown as PendingChanges;
}

function countPendingChanges(changes: PendingChanges): number {
  let count = Object.keys(changes.sourceDoc).length;
  for (const entry of Object.values(changes.entries)) count += Object.keys(entry).length;
  return count;
}

const EMPTY_CHANGES: PendingChanges = { sourceDoc: {}, entries: {} };

interface UseSourceDocumentDetailOptions {
  id: string;
  open: boolean;
  /** The live books, to name the record's own book when it has been archived. */
  books: readonly BookDto[];
  onClose: () => void;
}

/**
 * Everything the record sheet does: it reads the record, keeps the unsaved
 * edits as a draft, and runs every command against it. Pending edits never
 * rebase onto a newer server version; the save refuses them as a conflict.
 */
export function useSourceDocumentDetail({
  id,
  open,
  books,
  onClose,
}: UseSourceDocumentDetailOptions) {
  const t = useTranslations("SourceDocumentDetail");
  const tCommon = useTranslations("Common");
  const tActions = useTranslations("SourceDocumentAction");
  const queryClient = useQueryClient();
  const ledgerId = useLedgerId();

  // --- The record -----------------------------------------------------------

  const detailKey = queryKeys.sourceDocument(id);
  const query = useQuery({
    queryKey: detailKey,
    queryFn: async () => {
      const incoming = await fetchSourceDocumentDetail(id);
      const current = queryClient.getQueryData<SourceDocument>(detailKey);
      return incoming != null && current != null && current.version > incoming.version
        ? current
        : incoming;
    },
    enabled: open && id !== "",
    staleTime: QUERY.SOURCE_DOC_STALE_TIME_MS,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useLedgerRefreshPolling(open && id !== "");
  const sourceDocument = query.data ?? null;
  const ledgerEntries = sourceDocument?.ledgerEntries ?? NO_ENTRIES;

  // A record whose book was archived after it was filed is not in the live list,
  // so the picker resolves it separately rather than rendering blank. The query
  // only runs in that case.
  const recordBookId = sourceDocument?.bookId ?? null;
  const recordBookIsLive = recordBookId != null && books.some((book) => book.id === recordBookId);
  const { data: archivedRecordBook } = useQuery({
    queryKey: queryKeys.book(recordBookId ?? ""),
    queryFn: () => fetchBook(recordBookId!),
    enabled: open && recordBookId != null && !recordBookIsLive,
    staleTime: LEDGER.STALE_TIME_MS,
  });

  // --- Commands -------------------------------------------------------------

  /**
   * Writes a command's saved document into the detail cache unless a newer
   * version already arrived while the command was in flight, filling in the
   * fields the command responses leave out.
   */
  const commitDetailSnapshot = async (document: SourceDocument) => {
    await queryClient.cancelQueries({ queryKey: detailKey, exact: true });
    queryClient.setQueryData<SourceDocument>(detailKey, (previous) =>
      previous != null && previous.version > document.version
        ? previous
        : {
            ...document,
            hasImages: document.hasImages ?? false,
            ledgerEntries: document.ledgerEntries ?? [],
          }
    );
  };

  const saveMutation = useLedgerMutation<
    SaveSourceDocumentChangesResultDto,
    { expectedVersion: number; changes: PendingChanges; onCommitted: () => void }
  >({
    invalidates: ["documents", "stats"],
    mutationFn: async ({ expectedVersion, changes }) =>
      unwrapVersionedCommandResult(
        await saveSourceDocumentChangesAction(
          toSaveSourceDocumentChangesInput(id, expectedVersion, changes)
        )
      ),
    refreshMode: "background",
    refreshQueryKey: detailKey,
    onSuccess: (_result, input) => input.onCommitted(),
  });
  const splitMutation = useLedgerMutation<
    SplitSourceDocumentResultDto,
    Omit<SplitSourceDocumentInput, "sourceDocumentId">
  >({
    invalidates: ["documents", "stats"],
    mutationFn: (input) => splitSourceDocumentAction({ sourceDocumentId: id, ...input }),
    refreshMode: "background",
    onSuccess: (result) => commitDetailSnapshot(result.sourceDocument),
  });
  const dateOrganizationMutation = useLedgerMutation<
    ApplyDateOrganizationResultDto,
    Omit<ApplyDateOrganizationInput, "sourceDocumentId">
  >({
    invalidates: ["documents", "stats"],
    mutationFn: (input) => applyDateOrganizationAction({ sourceDocumentId: id, ...input }),
    refreshMode: "background",
    refreshQueryKey: detailKey,
    onSuccess: (result) => commitDetailSnapshot(result.sourceDocument),
  });
  const dismissDateOrganizationMutation = useLedgerMutation<{ dismissed: true }, string>({
    invalidates: ["documents"],
    mutationFn: (suggestionId) =>
      dismissDateOrganizationAction({ sourceDocumentId: id, suggestionId }),
    refreshMode: "background",
    refreshQueryKey: detailKey,
  });
  const addEntryMutation = useLedgerMutation<{ ledgerEntryId: string }, AddEntryData>({
    invalidates: ["documents", "stats"],
    mutationFn: (data) =>
      createLedgerEntryAction({ sourceDocumentId: id, ...data, amount: String(data.amount) }),
    refreshMode: "background",
    refreshQueryKey: detailKey,
  });
  const deleteEntryMutation = useLedgerMutation<
    { ledgerEntryId: string; deleted: true },
    { entryId: string; onCommitted: () => void }
  >({
    invalidates: ["documents", "stats"],
    mutationFn: ({ entryId }) => deleteLedgerEntryAction(id, entryId),
    refreshMode: "background",
    refreshQueryKey: detailKey,
    onSuccess: (_result, input) => input.onCommitted(),
  });
  const batchUpdateMutation = useLedgerMutation<
    { ledgerEntryIds: string[]; affectedCount: number },
    { ids: string[]; patch: BatchPatch }
  >({
    invalidates: ["documents", "stats"],
    mutationFn: ({ ids, patch }) => batchUpdateLedgerEntriesAction([id], ids, patch),
    refreshMode: "background",
    refreshQueryKey: detailKey,
  });
  const batchDeleteMutation = useLedgerMutation<
    PartialBatchCommandResult,
    { entryIds: string[]; onCommitted: (result: PartialBatchCommandResult) => void }
  >({
    invalidates: ["documents", "stats"],
    mutationFn: ({ entryIds }) => batchDeleteLedgerEntriesAction([id], entryIds),
    refreshMode: "background",
    refreshQueryKey: detailKey,
    onSuccess: (result, input) => input.onCommitted(result),
  });
  const deleteDocumentMutation = useLedgerMutation<unknown, (() => void) | undefined>({
    invalidates: ["documents", "stats"],
    mutationFn: () => deleteSourceDocumentAction(id),
    refreshMode: "background",
    successMessage: tCommon("deleteSuccess"),
    errorMessage: tCommon("deleteFailed"),
    onSuccess: (_result, onCommitted) => {
      onCommitted?.();
      onClose();
    },
  });
  const cancelMutation = useLedgerMutation<unknown, void>({
    invalidates: ["documents", "stats"],
    mutationFn: () => cancelSourceDocumentProcessingAction(id),
    successMessage: tActions("cancelSuccess"),
    errorMessage: tActions("cancelError"),
    onSuccess: onClose,
  });
  const assignBookMutation = useLedgerMutation({
    invalidates: ["documents", "stats"],
    // An archived target says so instead of snapping the picker back silently.
    errorMessage: tCommon("bookChangeFailed"),
    mutationFn: (bookId: string) =>
      assignSourceDocumentBookAction({ sourceDocumentId: id, bookId }),
    onSuccess: async () => {
      await query.refetch();
    },
  });

  // --- Pending edits and their draft ----------------------------------------

  const [pendingChanges, setPendingChanges] = useState<PendingChanges>(EMPTY_CHANGES);
  const hasPendingChanges =
    Object.keys(pendingChanges.sourceDoc).length > 0 ||
    Object.keys(pendingChanges.entries).length > 0;
  const discardAllChanges = useCallback(() => setPendingChanges(EMPTY_CHANGES), []);

  const handleSourceDocChange = useCallback(
    (changes: SourceDocPendingChanges) => {
      if (!sourceDocument) return;
      setPendingChanges((prev) => {
        const next = { ...prev.sourceDoc };
        for (const [key, value] of Object.entries(changes)) {
          const field = key as keyof SourceDocPendingChanges;
          const original =
            field === "title"
              ? (sourceDocument.title ?? "")
              : (sourceDocument.documentDate?.split("T")[0] ?? "");
          if (value === original) delete next[field];
          else next[field] = value;
        }
        return { ...prev, sourceDoc: next };
      });
    },
    [sourceDocument]
  );

  const handleEntryChange = useCallback(
    (entryId: string, changes: Partial<EntryEditData>) => {
      const entry = ledgerEntries.find((e) => e.id === entryId);
      if (!entry) return;
      setPendingChanges((prev) => {
        const entryChanges: Record<string, unknown> = { ...prev.entries[entryId] };
        for (const [key, value] of Object.entries(changes)) {
          const original = (entry as unknown as Record<string, unknown>)[key];
          if (value === original) delete entryChanges[key];
          else entryChanges[key] = value;
        }
        if (Object.keys(entryChanges).length === 0) {
          const { [entryId]: _, ...rest } = prev.entries;
          return { ...prev, entries: rest };
        }
        return { ...prev, entries: { ...prev.entries, [entryId]: entryChanges } };
      });
    },
    [ledgerEntries]
  );

  const [isEditMode, setIsEditMode] = useState(false);
  const key =
    ledgerId == null || sourceDocument == null
      ? null
      : draftKey(ledgerId, "source-document", sourceDocument.id);
  // Unsaved edits outlive the sheet: closing it keeps them for this record, and
  // the next opening restores them in edit mode against the version they were
  // made on, so a changed record still refuses them as a conflict.
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  const [draftBaseVersion, setDraftBaseVersion] = useState<number | null>(null);
  if (open && key != null && restoredKey !== key) {
    setRestoredKey(key);
    const draft = readDraft(key, parsePendingChanges);
    const baseVersion = draft?.basis == null ? NaN : Number(draft.basis);
    if (draft != null && Number.isInteger(baseVersion)) {
      setPendingChanges(draft.data);
      setDraftBaseVersion(baseVersion);
      setIsEditMode(true);
    }
  }

  // The version the edits started from. A newer server snapshot never rebases
  // them implicitly.
  const baseVersionRef = useRef<number | null>(null);
  const version = sourceDocument?.version;
  useEffect(() => {
    if (isEditMode || hasPendingChanges) {
      baseVersionRef.current ??= draftBaseVersion ?? version ?? null;
    } else {
      baseVersionRef.current = null;
    }
  }, [draftBaseVersion, hasPendingChanges, isEditMode, version]);
  // A restored draft's base is known before the effect records it.
  const baseVersion = baseVersionRef.current ?? draftBaseVersion;
  const hasVersionConflict =
    hasPendingChanges && baseVersion != null && version != null && baseVersion !== version;

  useEffect(() => {
    if (!open || key == null || restoredKey !== key) return;
    if (!hasPendingChanges) {
      clearDraft(key);
      return;
    }
    const base = baseVersionRef.current ?? version;
    writeDraft(key, pendingChanges, base == null ? null : String(base));
  }, [hasPendingChanges, key, open, pendingChanges, restoredKey, version]);

  // --- Sheet state ----------------------------------------------------------

  const selection = useSelection({ allIds: ledgerEntries.map((entry) => entry.id) });
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [reloadError, setReloadError] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [showRetryDialog, setShowRetryDialog] = useState(false);
  const [showSplitDialog, setShowSplitDialog] = useState(false);
  const [showAddEntryDialog, setShowAddEntryDialog] = useState(false);
  const [pendingDeleteEntryId, setPendingDeleteEntryId] = useState<string | null>(null);
  const [showBatchModePendingConfirm, setShowBatchModePendingConfirm] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setIsEditMode(false);
      setRestoredKey(null);
      setDraftBaseVersion(null);
      setPendingChanges(EMPTY_CHANGES);
    }
  }

  const busy =
    isSaving || isDeleting || isRetrying || isSplitting || isReloading || cancelMutation.isPending;
  const interactionDisabled = busy || sourceDocument == null;
  const discardEditsGate = useConfirmGate<() => void>();
  const deferredGate = useConfirmGate<DeferredAction>();
  const { setConfirmOpen: setDeferredConfirmOpen } = deferredGate;
  useEffect(() => {
    if (hasVersionConflict) setDeferredConfirmOpen(false);
  }, [hasVersionConflict, setDeferredConfirmOpen]);

  const leaveEditing = () => {
    discardAllChanges();
    setDraftBaseVersion(null);
    setIsEditMode(false);
  };

  // --- Saving, reloading and editing ----------------------------------------

  const saveAll = async (): Promise<boolean> => {
    if (busy) return false;
    const expectedVersion = baseVersionRef.current ?? version;
    if (hasVersionConflict) {
      toast.error(t("saveConflict"));
      return false;
    }
    if (expectedVersion == null) {
      toast.error(t("saveAllFailed"));
      return false;
    }
    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({
        expectedVersion,
        changes: pendingChanges,
        onCommitted: leaveEditing,
      });
      leaveEditing();
      toast.success(t("saveAllSuccess", { count: countPendingChanges(pendingChanges) }));
      return true;
    } catch (error) {
      // A stale save keeps the edits like any failure, but says they were made
      // on outdated data rather than that the save itself failed.
      toast.error(
        error instanceof SourceDocumentStaleCommandError ? t("saveConflict") : t("saveAllFailed")
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const reload = async () => {
    if (isReloading) return false;
    setIsReloading(true);
    setReloadError(false);
    try {
      const result = await query.refetch();
      if (result.error != null || result.data == null) {
        throw result.error ?? new Error("Source document is unavailable");
      }
      discardAllChanges();
      setDraftBaseVersion(null);
      selection.clearSelection();
      return true;
    } catch {
      setReloadError(true);
      return false;
    } finally {
      setIsReloading(false);
    }
  };

  const cancelEditMode = () => {
    if (busy) return;
    const cancel = () => {
      leaveEditing();
      void reload();
    };
    if (hasPendingChanges) discardEditsGate.requestConfirmation(cancel);
    else cancel();
  };

  // --- Batch selection ------------------------------------------------------

  const enterBatchSelectionMode = () => {
    discardAllChanges();
    setIsEditMode(false);
    selection.setSelectionMode(true);
  };

  const toggleSelectionMode = () => {
    if (busy || sourceDocument == null || ledgerEntries.length === 0) return;
    if (selection.isSelectionMode) selection.setSelectionMode(false);
    else if (!isEditMode || !hasPendingChanges) enterBatchSelectionMode();
    else setShowBatchModePendingConfirm(true);
  };

  const batchPatch = async (patch: BatchPatch) => {
    if (selection.selectedIds.length === 0 || busy) return;
    setIsSaving(true);
    try {
      const result = await batchUpdateMutation.mutateAsync({
        ids: selection.selectedIds,
        patch,
      });
      if (result.affectedCount > 0) {
        toast.success(t("batchUpdateSuccess", { count: result.affectedCount }));
      }
      selection.clearSelection();
    } catch {
      toast.error(t("batchUpdateError"));
    } finally {
      setIsSaving(false);
    }
  };

  const batchDelete = async () => {
    if (busy) return false;
    setIsSaving(true);
    try {
      const result = await batchDeleteMutation.mutateAsync({
        entryIds: selection.selectedIds,
        onCommitted: (committed) => {
          if (committed.failed.length === 0) setShowBatchDeleteConfirm(false);
        },
      });
      const unresolved = result.failed.map((item) => item.id);
      if (unresolved.length === 0) selection.clearSelection();
      else selection.retainSelection(unresolved);
      if (result.succeeded.length > 0) {
        toast.success(t("batchDeleteSuccess", { count: result.succeeded.length }));
      }
      if (unresolved.length > 0) {
        toast.error(t("batchDeletePartial", { count: unresolved.length }));
      }
      if (unresolved.length === 0) setShowBatchDeleteConfirm(false);
      return unresolved.length === 0;
    } catch {
      toast.error(t("batchDeleteError"));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  // --- Entries and the record -----------------------------------------------

  const feedbackToastId = `source-document-entry:${sourceDocument?.id ?? ""}`;

  const openSplit = () => {
    if (busy || selection.selectedIds.length === 0) return;
    if (selection.selectedIds.length >= ledgerEntries.length) {
      toast.error(t("splitKeepOne"));
      return;
    }
    setShowSplitDialog(true);
  };

  const split = async (entryDate: string) => {
    if (busy) return;
    setIsSplitting(true);
    try {
      const result = await splitMutation.mutateAsync({
        ledgerEntryIds: selection.selectedIds,
        entryDate,
      });
      setShowSplitDialog(false);
      selection.clearSelection();
      toast.success(t("splitSuccess", { count: result.movedEntryCount }), {
        id: feedbackToastId,
        action: {
          label: t("viewSplitBill"),
          onClick: () =>
            openLedgerDetail({ type: "source-document", id: result.splitSourceDocumentId }),
        },
      });
    } catch {
      toast.error(t("splitFailed"));
    } finally {
      setIsSplitting(false);
    }
  };

  const addEntry = async (data: AddEntryData): Promise<boolean> => {
    if (busy) return false;
    setIsSaving(true);
    try {
      await addEntryMutation.mutateAsync(data);
      toast.success(t("addEntrySuccess"), { id: feedbackToastId, action: null });
      return true;
    } catch {
      toast.error(t("addEntryError"));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const deleteEntry = async (entryId: string): Promise<boolean> => {
    if (busy) return false;
    setIsSaving(true);
    try {
      await deleteEntryMutation.mutateAsync({
        entryId,
        onCommitted: () => setPendingDeleteEntryId(null),
      });
      toast.success(tCommon("deleteSuccess"), { id: feedbackToastId, action: null });
      return true;
    } catch {
      toast.error(tCommon("deleteFailed"));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const deleteDocument = async (onCommitted?: () => void) => {
    if (interactionDisabled) return;
    setIsDeleting(true);
    try {
      await deleteDocumentMutation.mutateAsync(onCommitted);
    } finally {
      setIsDeleting(false);
    }
  };

  const cancelLockRef = useRef(false);
  const cancelProcessing = async () => {
    if (cancelLockRef.current) return;
    cancelLockRef.current = true;
    try {
      await cancelMutation.mutateAsync();
    } catch {
      // The mutation already reported the failure.
    } finally {
      cancelLockRef.current = false;
    }
  };

  // --- Actions that wait on pending edits -----------------------------------

  const executeAction = async (action: DeferredAction) => {
    switch (action.type) {
      case "cancel-processing":
        await cancelProcessing();
        return;
      case "open-retry":
        setShowRetryDialog(true);
        return;
      case "open-delete":
        setShowDeleteConfirm(true);
        return;
      case "open-add":
        setShowAddEntryDialog(true);
        return;
      case "open-split":
        openSplit();
        return;
      case "request-entry-delete":
        setPendingDeleteEntryId(action.entryId);
        return;
      case "batch-delete":
        setShowBatchDeleteConfirm(true);
        return;
      case "batch-category":
        await batchPatch({ categoryId: action.categoryId });
        return;
      case "batch-currency":
        await batchPatch({ currency: action.currency });
    }
  };

  const requestAction = (action: DeferredAction) => {
    if (interactionDisabled || hasVersionConflict) return;
    if (hasPendingChanges) deferredGate.requestConfirmation(action);
    else void executeAction(action);
  };

  const continueDeferred = async (save: boolean) => {
    const action = deferredGate.peekConfirmation();
    if (action == null) return false;
    if (save) {
      if (!(await saveAll())) return false;
    } else {
      discardAllChanges();
    }
    deferredGate.resolveConfirmation();
    await executeAction(action);
    return true;
  };

  return {
    sourceDocument,
    ledgerEntries,
    isLoading: query.isLoading,
    loadError: query.error != null,
    archivedBookLabel:
      archivedRecordBook == null
        ? null
        : tCommon("archivedBookOption", { name: archivedRecordBook.name }),
    isAssigningBook: assignBookMutation.isPending,
    assignBook: (bookId: string) => assignBookMutation.mutate(bookId),
    applyDateOrganization: dateOrganizationMutation.mutateAsync,
    dismissDateOrganization: dismissDateOrganizationMutation.mutateAsync,
    isOrganizingDates:
      dateOrganizationMutation.isPending || dismissDateOrganizationMutation.isPending,
    isCancelling: cancelMutation.isPending,
    editor: {
      isEditMode,
      pendingChanges,
      hasPendingChanges,
      pendingChangesCount: countPendingChanges(pendingChanges),
      handleSourceDocChange,
      handleEntryChange,
      displayTitle: pendingChanges.sourceDoc.title ?? sourceDocument?.title ?? "",
      splitInitialDate:
        sourceDocument?.documentDate ?? sourceDocument?.createdAt.slice(0, 10) ?? "",
    },
    selection,
    status: {
      busy,
      interactionDisabled,
      isSaving,
      isSplitting,
      isReloading,
      reloadError,
      /** Set while the sheet shows edits restored from an earlier visit. */
      restoredDraft:
        draftBaseVersion != null && hasPendingChanges
          ? {
              outdated: sourceDocument != null && draftBaseVersion !== sourceDocument.version,
            }
          : null,
      setIsRetrying,
    },
    dialogs: {
      showDeleteConfirm,
      setShowDeleteConfirm,
      showBatchDeleteConfirm,
      setShowBatchDeleteConfirm,
      showRetryDialog,
      setShowRetryDialog,
      showSplitDialog,
      setShowSplitDialog,
      showAddEntryDialog,
      setShowAddEntryDialog,
      pendingDeleteEntryId,
      setPendingDeleteEntryId,
      showBatchModePendingConfirm,
      setShowBatchModePendingConfirm,
      discardEditsGate,
      saveAndContinueGate: {
        confirmOpen: deferredGate.confirmOpen,
        setConfirmOpen: deferredGate.setConfirmOpen,
        confirmSaveAndContinue: () => continueDeferred(true),
        confirmDiscardAndContinue: () => continueDeferred(false),
      },
    },
    actions: {
      handleClose: () => {
        if (!busy) onClose();
      },
      handleRequestLeave: (continueNavigation: () => void) => {
        if (!busy) continueNavigation();
      },
      handleEnterEditMode: () => {
        if (!selection.isSelectionMode && !interactionDisabled) setIsEditMode(true);
      },
      handleCancelEditMode: cancelEditMode,
      handleEditSave: saveAll,
      handleConfirmDiscardEdits: () => discardEditsGate.resolveConfirmation()?.(),
      /** Drops a restored draft without leaving the sheet. */
      handleDiscardDraft: () => {
        if (!busy) leaveEditing();
      },
      handleReload: reload,
      handleSaveAndEnterBatchMode: async () => {
        if (!(await saveAll())) return false;
        setIsEditMode(false);
        selection.setSelectionMode(true);
        setShowBatchModePendingConfirm(false);
        return true;
      },
      handleDiscardAndEnterBatchMode: () => {
        enterBatchSelectionMode();
        setShowBatchModePendingConfirm(false);
      },
      handleToggleSelectionMode: toggleSelectionMode,
      handleBatchDelete: batchDelete,
      handleSplit: split,
      handleAddEntrySubmit: addEntry,
      handleDeleteEntry: deleteEntry,
      handleDeleteDocument: deleteDocument,
      handleBatchCategory: (categoryId: string | null) =>
        requestAction({ type: "batch-category", categoryId }),
      handleBatchCurrency: (currency: string) =>
        requestAction({ type: "batch-currency", currency }),
      handleOpenBatchDelete: () => requestAction({ type: "batch-delete" }),
      handleCancelProcessing: () => requestAction({ type: "cancel-processing" }),
      handleOpenRetry: () => requestAction({ type: "open-retry" }),
      handleRequestDelete: () => requestAction({ type: "open-delete" }),
      handleOpenAddEntry: () => requestAction({ type: "open-add" }),
      handleOpenSplit: () => requestAction({ type: "open-split" }),
      handleRequestDeleteEntry: (entryId: string) =>
        requestAction({ type: "request-entry-delete", entryId }),
    },
  };
}
