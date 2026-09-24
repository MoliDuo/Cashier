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
import { serverComposition } from "@/application/server-composition-root";
import { getBatchEntryDateImpact } from "../server/entry-reads/get-batch-entry-date-impact";
import {
  parseVersionedTarget,
  parseVersionedTargets,
} from "@/modules/source-document/contract-schemas";
import type {
  AtomicBatchCommandResult,
  PartialBatchCommandResult,
  VersionedTarget,
} from "@/modules/source-document/contracts";

export const createLedgerEntryAction = withLedgerAccess(
  async (ledgerId: string, target: VersionedTarget, data: CreateLedgerEntryInput) => {
    const validatedTarget = parseVersionedTarget(target);
    const validated = parseCreateLedgerEntryInput(data);
    if (validated.sourceDocumentId !== validatedTarget.sourceDocumentId) {
      throw new Error("Source document target does not match entry payload");
    }
    return serverComposition.sourceDocumentAggregate.addEntry({
      ledgerId,
      target: validatedTarget,
      amount: String(validated.amount),
      itemName: validated.itemName,
      ...(validated.currency === undefined ? {} : { currency: validated.currency }),
      ...(validated.categoryId === undefined ? {} : { categoryId: validated.categoryId }),
      ...(validated.description === undefined ? {} : { description: validated.description }),
    });
  }
);

export const deleteLedgerEntryAction = withLedgerAccess(
  async (ledgerId: string, target: VersionedTarget, ledgerEntryId: string) => {
    const validatedTarget = parseVersionedTarget(target);
    const validatedLedgerEntryId = parseLedgerEntryId(ledgerEntryId);
    return serverComposition.sourceDocumentAggregate.deleteEntries({
      ledgerId,
      target: validatedTarget,
      ledgerEntryId: validatedLedgerEntryId,
    });
  }
);

export const batchUpdateLedgerEntriesAction = withLedgerAccess(
  async (
    ledgerId: string,
    inputTargets: VersionedTarget[],
    ledgerEntryIds: string[],
    data: BatchUpdateLedgerEntriesInput
  ): Promise<AtomicBatchCommandResult<{ ledgerEntryIds: string[]; affectedCount: number }>> => {
    const targets = parseVersionedTargets(inputTargets);
    const validatedLedgerEntryIds = parseLedgerEntryIds(ledgerEntryIds);
    const validated = parseBatchUpdateLedgerEntriesInput(data);
    const payload: Parameters<
      typeof serverComposition.sourceDocumentAggregate.batchUpdateEntries
    >[0] = {
      ledgerId,
      targets,
      ledgerEntryIds: validatedLedgerEntryIds,
    };
    if (validated.categoryId !== undefined) payload.categoryId = validated.categoryId;
    if (validated.currency !== undefined) payload.currency = validated.currency;
    if (validated.amount !== undefined) payload.amount = String(validated.amount);
    if (validated.description !== undefined) payload.description = validated.description;
    if (validated.itemName !== undefined) payload.itemName = validated.itemName;
    return serverComposition.sourceDocumentAggregate.batchUpdateEntries(payload);
  }
);

export const batchDeleteLedgerEntriesAction = withLedgerAccess(
  async (
    ledgerId: string,
    inputTargets: VersionedTarget[],
    inputIds: string[]
  ): Promise<PartialBatchCommandResult> => {
    const targets = parseVersionedTargets(inputTargets);
    const ids = parseLedgerEntryIds(inputIds);
    return serverComposition.sourceDocumentAggregate.batchDeleteEntries({
      ledgerId,
      targets,
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
  async (
    ledgerId: string,
    inputTargets: VersionedTarget[],
    inputIds: string[],
    entryDate: string
  ) => {
    const targets = parseVersionedTargets(inputTargets);
    const validated = parseBatchUpdateLedgerEntryDatesInput({
      entryIds: inputIds,
      entryDate,
    });
    const impact = await serverComposition.sourceDocumentAggregate.updateEntryDates({
      ledgerId,
      targets,
      ledgerEntryIds: validated.entryIds,
      entryDate: validated.entryDate,
    });
    return impact;
  }
);
