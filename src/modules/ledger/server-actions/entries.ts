"use server";
import { withLedgerAccess } from "../access";
import {
  parseBatchUpdateLedgerEntriesInput,
  parseBatchUpdateLedgerEntryDatesInput,
  parseCreateLedgerEntryInput,
  parseLedgerEntryId,
  parseLedgerEntryIds,
  type BatchUpdateLedgerEntriesInput,
  type CreateLedgerEntryInput,
} from "@/modules/ledger/contract-schemas";
import {
  addLedgerEntry,
  batchDeleteLedgerEntries,
  batchUpdateLedgerEntries,
  deleteLedgerEntry,
  type BatchUpdateLedgerEntriesInput as BatchUpdateLedgerEntriesCommand,
} from "@/modules/source-document/server/entry-commands";
import { updateLedgerEntryDates } from "@/modules/source-document/server/updates";
import { getBatchEntryDateImpact } from "../server/entry-reads/get-batch-entry-date-impact";
import {
  parseSourceDocumentId,
  parseSourceDocumentTargetIds,
} from "@/modules/source-document/contract-schemas";
import type { PartialBatchCommandResult } from "@/modules/source-document/contracts";

export const createLedgerEntryAction = withLedgerAccess(
  async (ledgerId: string, data: CreateLedgerEntryInput) => {
    const validated = parseCreateLedgerEntryInput(data);
    return addLedgerEntry({
      ledgerId,
      sourceDocumentId: validated.sourceDocumentId,
      amount: String(validated.amount),
      itemName: validated.itemName,
      ...(validated.currency === undefined ? {} : { currency: validated.currency }),
      ...(validated.categoryId === undefined ? {} : { categoryId: validated.categoryId }),
      ...(validated.description === undefined ? {} : { description: validated.description }),
    });
  }
);

export const deleteLedgerEntryAction = withLedgerAccess(
  async (ledgerId: string, sourceDocumentId: string, ledgerEntryId: string) => {
    const validatedSourceDocumentId = parseSourceDocumentId(sourceDocumentId);
    const validatedLedgerEntryId = parseLedgerEntryId(ledgerEntryId);
    return deleteLedgerEntry({
      ledgerId,
      sourceDocumentId: validatedSourceDocumentId,
      ledgerEntryId: validatedLedgerEntryId,
    });
  }
);

export const batchUpdateLedgerEntriesAction = withLedgerAccess(
  async (
    ledgerId: string,
    sourceDocumentIds: string[],
    ledgerEntryIds: string[],
    data: BatchUpdateLedgerEntriesInput
  ): Promise<{ ledgerEntryIds: string[]; affectedCount: number }> => {
    const validatedSourceDocumentIds = parseSourceDocumentTargetIds(sourceDocumentIds);
    const validatedLedgerEntryIds = parseLedgerEntryIds(ledgerEntryIds);
    const validated = parseBatchUpdateLedgerEntriesInput(data);
    const payload: BatchUpdateLedgerEntriesCommand = {
      ledgerId,
      sourceDocumentIds: validatedSourceDocumentIds,
      ledgerEntryIds: validatedLedgerEntryIds,
    };
    if (validated.categoryId !== undefined) payload.categoryId = validated.categoryId;
    if (validated.currency !== undefined) payload.currency = validated.currency;
    if (validated.amount !== undefined) payload.amount = String(validated.amount);
    if (validated.description !== undefined) payload.description = validated.description;
    if (validated.itemName !== undefined) payload.itemName = validated.itemName;
    return batchUpdateLedgerEntries(payload);
  }
);

export const batchDeleteLedgerEntriesAction = withLedgerAccess(
  async (
    ledgerId: string,
    sourceDocumentIds: string[],
    inputIds: string[]
  ): Promise<PartialBatchCommandResult> => {
    const validatedSourceDocumentIds = parseSourceDocumentTargetIds(sourceDocumentIds);
    const ids = parseLedgerEntryIds(inputIds);
    return batchDeleteLedgerEntries({
      ledgerId,
      sourceDocumentIds: validatedSourceDocumentIds,
      ledgerEntryIds: ids,
    });
  }
);
export const previewBatchLedgerEntryDateAction = withLedgerAccess(
  async (ledgerId: string, inputIds: string[]) => {
    const entryIds = parseLedgerEntryIds(inputIds);
    return getBatchEntryDateImpact({
      ledgerId,
      ledgerEntryIds: entryIds,
    });
  }
);

export const batchUpdateLedgerEntryDatesAction = withLedgerAccess(
  async (ledgerId: string, sourceDocumentIds: string[], inputIds: string[], entryDate: string) => {
    const validatedSourceDocumentIds = parseSourceDocumentTargetIds(sourceDocumentIds);
    const validated = parseBatchUpdateLedgerEntryDatesInput({
      entryIds: inputIds,
      entryDate,
    });
    const impact = await updateLedgerEntryDates({
      ledgerId,
      sourceDocumentIds: validatedSourceDocumentIds,
      ledgerEntryIds: validated.entryIds,
      entryDate: validated.entryDate,
    });
    return impact;
  }
);
