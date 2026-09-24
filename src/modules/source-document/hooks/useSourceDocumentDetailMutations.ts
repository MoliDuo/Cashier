"use client";

import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { SourceDocumentDetailDto } from "../contracts";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { saveSourceDocumentChangesAction } from "@/modules/source-document/server-actions/update";
import { splitSourceDocumentAction } from "@/modules/source-document/server-actions/split";
import {
  applyDateOrganizationAction,
  dismissDateOrganizationAction,
} from "@/modules/source-document/server-actions/date-organization";
import {
  createLedgerEntryAction,
  deleteLedgerEntryAction,
} from "@/modules/ledger/server-actions/entries";
import type {
  SaveSourceDocumentChangesResultDto,
  SplitSourceDocumentInput,
  SplitSourceDocumentResultDto,
  PartialBatchCommandResult,
  ApplyDateOrganizationInput,
  ApplyDateOrganizationResultDto,
} from "@/modules/source-document/contracts";
import {
  requireSourceDocumentVersion,
  unwrapVersionedCommandResult,
} from "@/modules/source-document/command-results";
import type { PendingChanges } from "@/modules/source-document/detail-types";
import { useSourceDocumentEntryMutations } from "./useSourceDocumentEntryMutations";
import { useSourceDocumentRecordMutations } from "./useSourceDocumentRecordMutations";
import type { BatchEntryUpdateData } from "./source-document-detail-cache";

interface UseSourceDocumentDetailMutationsOptions {
  id: string;
  ledgerId: string | undefined;
  /** Read fresh at submission time — never captured ahead of the actual click. */
  version: number | null;
  onClose: () => void;
}

interface SaveDetailChanges {
  expectedVersion: number;
  changes: PendingChanges;
  onCommitted?: (() => void) | undefined;
}

/** Fields collected by the "add entry" dialog for a new ledger entry. */
export interface AddEntryData {
  itemName: string;
  amount: number;
  currency?: string;
  categoryId?: string;
  description?: string | null;
}

export function useSourceDocumentDetailMutations({
  id,
  ledgerId,
  version,
  onClose,
}: UseSourceDocumentDetailMutationsOptions) {
  const tCommon = useTranslations("Common");
  const queryClient = useQueryClient();

  const { deleteDocumentMutation } = useSourceDocumentRecordMutations({
    id,
    ledgerId,
    version,
    onClose,
  });

  const { batchUpdateMutation, batchDeleteMutation } = useSourceDocumentEntryMutations({
    ledgerId,
    sourceDocumentId: id,
    version,
  });

  /**
   * Writes a command's saved document into the detail cache unless a newer
   * version already arrived while the command was in flight, filling in the
   * fields the command responses leave out.
   */
  const commitDetailSnapshot = async (document: SourceDocumentDetailDto) => {
    const key = queryKeys.sourceDocument(ledgerId!, id);
    await queryClient.cancelQueries({ queryKey: key, exact: true });
    queryClient.setQueryData<SourceDocumentDetailDto>(key, (previous) =>
      previous != null && previous.version > document.version
        ? previous
        : {
            ...document,
            hasImages: document.hasImages ?? false,
            ledgerEntries: document.ledgerEntries ?? [],
          }
    );
  };

  const saveChangesMutation = useLedgerMutation<
    SaveSourceDocumentChangesResultDto,
    SaveDetailChanges
  >(ledgerId, {
    invalidates: ["documents", "stats"],
    mutationFn: async ({ expectedVersion, changes }: SaveDetailChanges) => {
      if (ledgerId == null || ledgerId === "") throw new Error("No ledger ID");
      const result = await saveSourceDocumentChangesAction(ledgerId, {
        sourceDocumentId: id,
        expectedVersion,
        ...(Object.keys(changes.sourceDoc).length === 0
          ? {}
          : { sourceDocument: changes.sourceDoc }),
        entries: Object.entries(changes.entries)
          .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
          .map(([ledgerEntryId, data]) => ({
            ledgerEntryId,
            data,
          })),
      });
      return unwrapVersionedCommandResult(result);
    },
    successMessage: null,
    errorMessage: null,
    refreshMode: "background",
    refreshQueryKey: queryKeys.sourceDocument(ledgerId ?? "", id),
    invalidationErrorMessage: tCommon("savedRefreshFailed"),
    onSuccess: (_result, input) => input.onCommitted?.(),
  });

  const splitMutation = useLedgerMutation<
    SplitSourceDocumentResultDto,
    Omit<SplitSourceDocumentInput, "sourceDocumentId">
  >(ledgerId, {
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: async (input: Omit<SplitSourceDocumentInput, "sourceDocumentId">) => {
      if (ledgerId == null || ledgerId === "") throw new Error("No ledger ID");
      const result = await splitSourceDocumentAction(ledgerId, { sourceDocumentId: id, ...input });
      return unwrapVersionedCommandResult(result);
    },
    successMessage: null,
    errorMessage: null,
    invalidationErrorMessage: tCommon("savedRefreshFailed"),
    onSuccess: (result) => commitDetailSnapshot(result.sourceDocument),
  });

  const dateOrganizationMutation = useLedgerMutation<
    ApplyDateOrganizationResultDto,
    Omit<ApplyDateOrganizationInput, "sourceDocumentId" | "expectedVersion">
  >(ledgerId, {
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    refreshQueryKey: queryKeys.sourceDocument(ledgerId ?? "", id),
    mutationFn: async (input) => {
      if (ledgerId == null || ledgerId === "") throw new Error("No ledger ID");
      const result = await applyDateOrganizationAction(ledgerId, {
        sourceDocumentId: id,
        expectedVersion: requireSourceDocumentVersion(version, id),
        ...input,
      });
      return unwrapVersionedCommandResult(result);
    },
    successMessage: null,
    errorMessage: null,
    onSuccess: (result) => commitDetailSnapshot(result.sourceDocument),
  });

  const dismissDateOrganizationMutation = useLedgerMutation<
    { dismissed: true },
    { suggestionId: string }
  >(ledgerId, {
    refreshMode: "background",
    invalidates: ["documents"],
    refreshQueryKey: queryKeys.sourceDocument(ledgerId ?? "", id),
    mutationFn: async ({ suggestionId }) => {
      if (ledgerId == null || ledgerId === "") throw new Error("No ledger ID");
      const result = await dismissDateOrganizationAction(ledgerId, {
        sourceDocumentId: id,
        expectedVersion: requireSourceDocumentVersion(version, id),
        suggestionId,
      });
      return unwrapVersionedCommandResult(result);
    },
    successMessage: null,
    errorMessage: null,
  });

  const addEntryMutation = useLedgerMutation<{ ledgerEntryId: string }, AddEntryData>(ledgerId, {
    refreshMode: "background",
    refreshQueryKey: queryKeys.sourceDocument(ledgerId ?? "", id),
    invalidates: ["documents", "stats"],
    mutationFn: async (data: AddEntryData) => {
      if (ledgerId == null || ledgerId === "") throw new Error("No ledger ID");
      const expectedVersion = requireSourceDocumentVersion(version, id);
      const result = await createLedgerEntryAction(
        ledgerId,
        { sourceDocumentId: id, expectedVersion },
        { sourceDocumentId: id, ...data, amount: String(data.amount) }
      );
      return unwrapVersionedCommandResult(result);
    },
    successMessage: null,
    errorMessage: null,
    invalidationErrorMessage: tCommon("savedRefreshFailed"),
  });

  const deleteEntryMutation = useLedgerMutation<
    { ledgerEntryId: string; deleted: true },
    { entryId: string; onCommitted?: (() => void) | undefined }
  >(ledgerId, {
    invalidates: ["documents", "stats"],
    mutationFn: async ({ entryId }) => {
      if (ledgerId == null || ledgerId === "") throw new Error("No ledger ID");
      const expectedVersion = requireSourceDocumentVersion(version, id);
      const result = await deleteLedgerEntryAction(
        ledgerId,
        { sourceDocumentId: id, expectedVersion },
        entryId
      );
      return unwrapVersionedCommandResult(result);
    },
    successMessage: null,
    errorMessage: null,
    refreshMode: "background",
    refreshQueryKey: queryKeys.sourceDocument(ledgerId ?? "", id),
    invalidationErrorMessage: tCommon("savedRefreshFailed"),
    onSuccess: (_result, input) => input.onCommitted?.(),
  });

  return {
    saveChanges: async (input: SaveDetailChanges, onCommitted?: () => void) => {
      await saveChangesMutation.mutateAsync({ ...input, onCommitted });
    },
    splitEntries: (input: Omit<SplitSourceDocumentInput, "sourceDocumentId">) =>
      splitMutation.mutateAsync(input),
    applyDateOrganization: dateOrganizationMutation.mutateAsync,
    dismissDateOrganization: (suggestionId: string) =>
      dismissDateOrganizationMutation.mutateAsync({ suggestionId }),
    addEntry: async (data: AddEntryData) => {
      await addEntryMutation.mutateAsync(data);
    },
    deleteEntry: async (entryId: string, onCommitted?: () => void) => {
      await deleteEntryMutation.mutateAsync({ entryId, onCommitted });
    },
    batchUpdate: async (ids: string[], data: BatchEntryUpdateData) =>
      batchUpdateMutation.mutateAsync({ ids, data }),
    batchDeleteEntries: (
      entryIds: string[],
      onCommitted?: (result: PartialBatchCommandResult) => void
    ) => batchDeleteMutation.mutateAsync({ entryIds, onCommitted }),
    deleteDocument: async (onCommitted?: () => void) => {
      await deleteDocumentMutation.mutateAsync(onCommitted);
    },
    isSavingChanges: saveChangesMutation.isPending,
    isSplitting: splitMutation.isPending,
    isOrganizingDates:
      dateOrganizationMutation.isPending || dismissDateOrganizationMutation.isPending,
  };
}

export type { BatchEntryUpdateData };
