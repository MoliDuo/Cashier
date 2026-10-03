-- Files reach the server in one request and are recorded as ready, so the
-- plan-then-finalize step is gone. Rows still waiting for finalization are
-- abandoned upload plans no document can reference; they go before the column.
DELETE FROM "stored_files" AS file
WHERE file."finalized_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "source_document_files" AS link
    WHERE link."stored_file_id" = file."id"
  );
--> statement-breakpoint
ALTER TABLE "stored_files" DROP COLUMN "finalized_at";
