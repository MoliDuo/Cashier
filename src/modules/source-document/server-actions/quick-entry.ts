"use server";
import { createQuickEntry } from "../server/create-quick-entry";
import type { QuickEntryResponseDto } from "@/modules/source-document/contracts";
import {
  createQuickEntryInputSchema,
  type CreateQuickEntryInput,
} from "@/modules/source-document/contract-schemas";
import { withSourceDocumentLedgerAccess } from "./access";
import { resolveRecordBook } from "../server/resolve-record-book";

/**
 * Create a quick entry (manual entry without AI parsing).
 * Atomically creates a completed SourceDocument and a LedgerEntry without AI parsing.
 */
export const createQuickEntryAction = withSourceDocumentLedgerAccess(
  async ({ ledgerId, ledger }, data: CreateQuickEntryInput): Promise<QuickEntryResponseDto> => {
    const validated = createQuickEntryInputSchema.parse(data);
    const book = await resolveRecordBook(ledgerId, validated.bookId);
    // The book owns the record's date zone, exactly as the AI path resolves it;
    // the request's own zone is only a fallback for a book without one.
    const zone = book.timeZone ?? validated.timezone;
    const payload = {
      bookId: book.id,
      ...(zone != null ? { timeZone: zone } : {}),
      categoryId: validated.categoryId,
      amount: validated.amount,
      ...(validated.currency !== undefined ? { currency: validated.currency } : {}),
      ...(validated.itemName !== undefined ? { itemName: validated.itemName } : {}),
      ...(validated.description !== undefined ? { description: validated.description } : {}),
      ...(validated.entryDate !== undefined ? { entryDate: validated.entryDate } : {}),
    };

    return createQuickEntry(ledgerId, ledger, payload);
  }
);
