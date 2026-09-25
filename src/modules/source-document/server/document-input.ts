import "server-only";
import { sql } from "drizzle-orm";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";

/**
 * Makes a revision's input the document's current input: its text on the
 * document and its files in `source_document_files`, replacing the previous
 * ones. Callers pass the revision the document now reads its input from — the
 * latest submission, or the active revision of a record with none.
 */
export async function copyRevisionInputToDocument(
  tx: PostgresTransaction,
  input: { ledgerId: string; sourceDocumentId: string; revisionId: string }
): Promise<void> {
  await tx.execute(sql`
    UPDATE source_documents
    SET input_text = (
      SELECT input_text FROM source_document_revisions
      WHERE ledger_id = ${input.ledgerId} AND id = ${input.revisionId}
    )
    WHERE ledger_id = ${input.ledgerId} AND id = ${input.sourceDocumentId}
  `);
  await tx.execute(sql`
    DELETE FROM source_document_files
    WHERE ledger_id = ${input.ledgerId} AND source_document_id = ${input.sourceDocumentId}
  `);
  await tx.execute(sql`
    INSERT INTO source_document_files (ledger_id, source_document_id, stored_file_id, position, created_at)
    SELECT ledger_id, ${input.sourceDocumentId}, stored_file_id, position, now()
    FROM revision_files
    WHERE ledger_id = ${input.ledgerId} AND revision_id = ${input.revisionId}
  `);
}
