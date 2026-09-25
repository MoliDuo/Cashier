"use server";

import { withSourceDocumentLedgerAccess } from "./access";
import { assignSourceDocumentBook } from "../server/updates";
import { parseAssignSourceDocumentBookInput } from "@/modules/ledger/contract-schemas";
import { ValidationError } from "@/lib/errors";

/**
 * Moves one record to another book.
 *
 * The two failures are told apart rather than collapsed: a vanished record is a
 * not-found, and a book that was archived under the reader's cursor is a
 * validation failure of the choice they made.
 */
export const assignSourceDocumentBookAction = withSourceDocumentLedgerAccess(
  async ({ ledgerId }, input: unknown): Promise<{ bookId: string }> => {
    const validated = parseAssignSourceDocumentBookInput(input);
    const result = await assignSourceDocumentBook({
      ledgerId,
      sourceDocumentId: validated.sourceDocumentId,
      bookId: validated.bookId,
    });
    if (!result.ok) throw new ValidationError("The target book is not available");
    return { bookId: validated.bookId };
  }
);
