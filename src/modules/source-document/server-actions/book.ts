"use server";

import { withSourceDocumentLedgerAccess } from "./access";
import { serverComposition } from "@/application/server-composition-root";
import { parseAssignSourceDocumentBookInput } from "@/modules/ledger/contract-schemas";
import { NotFoundError } from "@/lib/errors";

/** Moves one record to another book; the version guards concurrent edits. */
export const assignSourceDocumentBookAction = withSourceDocumentLedgerAccess(
  async ({ ledgerId }, input: unknown): Promise<{ bookId: string; version: number }> => {
    const validated = parseAssignSourceDocumentBookInput(input);
    const result = await serverComposition.sourceDocumentAggregate.assignBook({
      ledgerId,
      sourceDocumentId: validated.sourceDocumentId,
      expectedVersion: validated.expectedVersion,
      bookId: validated.bookId,
    });
    if (!result.ok) throw new NotFoundError("Record");
    return { bookId: validated.bookId, version: result.version };
  }
);
