"use server";

import { withSourceDocumentLedgerAccess } from "./access";
import { assignSourceDocumentBook } from "../server/updates";
import { parseAssignSourceDocumentBookInput } from "@/modules/ledger/contract-schemas";
import { ConflictError, ValidationError } from "@/lib/errors";

/**
 * Moves one record to another book; the version guards concurrent edits.
 *
 * The three failures are told apart rather than collapsed: a stale version is a
 * conflict the client may retry against fresh data, a vanished record is a
 * not-found, and a book that was archived under the reader's cursor is a
 * validation failure of the choice they made.
 */
export const assignSourceDocumentBookAction = withSourceDocumentLedgerAccess(
  async ({ ledgerId }, input: unknown): Promise<{ bookId: string; version: number }> => {
    const validated = parseAssignSourceDocumentBookInput(input);
    const result = await assignSourceDocumentBook({
      ledgerId,
      sourceDocumentId: validated.sourceDocumentId,
      expectedVersion: validated.expectedVersion,
      bookId: validated.bookId,
    });
    if (!result.ok) {
      if (result.reason === "book_unavailable") {
        throw new ValidationError("The target book is not available");
      }
      // A version conflict is not a missing record: the record exists and the
      // caller is looking at an older copy of it.
      throw new ConflictError(`Record version conflict: expected ${validated.expectedVersion}`);
    }
    return { bookId: validated.bookId, version: result.version };
  }
);
