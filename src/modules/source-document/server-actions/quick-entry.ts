"use server";
import { createQuickEntry } from "@/modules/source-document/application/use-cases/create-quick-entry";
import type { QuickEntryResponseDto } from "@/modules/source-document/contracts";
import {
  createQuickEntryInputSchema,
  type CreateQuickEntryInput,
} from "@/modules/source-document/contract-schemas";
import { withSourceDocumentLedgerAccess } from "./access";
import { serverComposition } from "@/application/server-composition-root";
import { convertEntryAmount } from "@/modules/currency/application/use-cases/convert-entry-amount";
import { isCoupleMember } from "@/lib/couple-config";
import { ValidationError } from "@/lib/errors";

/**
 * Create a quick entry (manual entry without AI parsing).
 * Atomically creates a completed SourceDocument and a LedgerEntry without AI parsing.
 */
export const createQuickEntryAction = withSourceDocumentLedgerAccess(
  async (
    { ledgerId, ledger, userId },
    data: CreateQuickEntryInput
  ): Promise<QuickEntryResponseDto> => {
    const validated = createQuickEntryInputSchema.parse(data);
    const attributedUserId = validated.attributedUserId ?? userId;
    if (!isCoupleMember(attributedUserId)) throw new ValidationError("Invalid member attribution");
    const payload = {
      attributedUserId,
      createdByUserId: userId,
      categoryId: validated.categoryId,
      amount: validated.amount,
      ...(validated.currency !== undefined ? { currency: validated.currency } : {}),
      ...(validated.itemName !== undefined ? { itemName: validated.itemName } : {}),
      ...(validated.description !== undefined ? { description: validated.description } : {}),
      ...(validated.entryDate !== undefined ? { entryDate: validated.entryDate } : {}),
    };

    return createQuickEntry(ledgerId, ledger, payload, {
      categories: serverComposition.categories,
      projections: { createManual: serverComposition.sourceDocumentAggregate.createManualDocument },
      convertAmount: (input) => convertEntryAmount(input, serverComposition.exchangeRates),
    });
  }
);
