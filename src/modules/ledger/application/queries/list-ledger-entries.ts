import {
  type ListLedgerEntriesInput,
  type ListLedgerEntriesValidatedInput,
  UNCATEGORIZED_SENTINEL,
  parseListLedgerEntriesInput,
} from "@/modules/ledger/contract-schemas";
import type { LedgerEntryPageDto } from "@/modules/ledger/contracts";
import type { LedgerReadPort } from "../ports";

export async function listLedgerEntries(
  ledgerId: string,
  params: ListLedgerEntriesInput,
  reads: Pick<LedgerReadPort, "listEntries">
): Promise<LedgerEntryPageDto> {
  const validated = parseListLedgerEntriesInput(params);
  const uncategorizedOnly = validated.categoryId === UNCATEGORIZED_SENTINEL;
  return listLedgerEntriesFromValidatedInput(ledgerId, validated, { uncategorizedOnly }, reads);
}

async function listLedgerEntriesFromValidatedInput(
  ledgerId: string,
  validated: ListLedgerEntriesValidatedInput,
  options: { uncategorizedOnly?: boolean } | undefined,
  reads: Pick<LedgerReadPort, "listEntries">
): Promise<LedgerEntryPageDto> {
  const filters: Parameters<LedgerReadPort["listEntries"]>[0]["filters"] = {};
  if (validated.attributedUserId !== undefined)
    filters.attributedUserId = validated.attributedUserId;
  if (validated.startDate !== undefined) filters.startDate = validated.startDate;
  if (validated.endDate !== undefined) filters.endDate = validated.endDate;
  if (validated.categoryId !== undefined && validated.categoryId !== UNCATEGORIZED_SENTINEL) {
    filters.categoryId = validated.categoryId;
  }
  if (validated.currency !== undefined) filters.currency = validated.currency;
  if (validated.minAmount !== undefined) filters.minAmount = validated.minAmount;
  if (validated.maxAmount !== undefined) filters.maxAmount = validated.maxAmount;
  if (validated.search !== undefined) filters.search = validated.search;
  if (options?.uncategorizedOnly) {
    filters.uncategorizedOnly = true;
  }

  const result = await reads.listEntries({
    ledgerId,
    limit: validated.limit,
    cursor: validated.cursor ?? null,
    filters,
  });

  return {
    ...result,
    nextCursor: result.nextCursor ?? null,
  };
}
