import "server-only";
import { sql } from "drizzle-orm";
import { sourceDocumentFiles } from "@/persistence";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";

/**
 * Makes the given text and files the document's current input, replacing the
 * previous ones. The caller has already checked the files belong to the ledger.
 */
export async function replaceDocumentInput(
  tx: PostgresTransaction,
  input: {
    ledgerId: string;
    sourceDocumentId: string;
    text: string | null;
    storedFileIds: readonly string[];
  }
): Promise<void> {
  await tx.execute(sql`
    UPDATE source_documents SET input_text = ${input.text}
    WHERE ledger_id = ${input.ledgerId} AND id = ${input.sourceDocumentId}
  `);
  await tx.execute(sql`
    DELETE FROM source_document_files
    WHERE ledger_id = ${input.ledgerId} AND source_document_id = ${input.sourceDocumentId}
  `);
  if (input.storedFileIds.length === 0) return;
  await tx.insert(sourceDocumentFiles).values(
    input.storedFileIds.map((storedFileId, position) => ({
      ledgerId: input.ledgerId,
      sourceDocumentId: input.sourceDocumentId,
      storedFileId,
      position,
      createdAt: new Date(),
    }))
  );
}

/**
 * Gives a document split off another the input the original shows: its text
 * and the same files, so the new record keeps the evidence it came from.
 */
export async function copyDocumentInput(
  tx: PostgresTransaction,
  input: { ledgerId: string; fromDocumentId: string; toDocumentId: string }
): Promise<void> {
  await tx.execute(sql`
    UPDATE source_documents AS target
    SET input_text = origin.input_text
    FROM source_documents AS origin
    WHERE origin.ledger_id = ${input.ledgerId} AND origin.id = ${input.fromDocumentId}
      AND target.ledger_id = ${input.ledgerId} AND target.id = ${input.toDocumentId}
  `);
  await tx.execute(sql`
    INSERT INTO source_document_files (ledger_id, source_document_id, stored_file_id, position, created_at)
    SELECT ledger_id, ${input.toDocumentId}, stored_file_id, position, now()
    FROM source_document_files
    WHERE ledger_id = ${input.ledgerId} AND source_document_id = ${input.fromDocumentId}
  `);
}
