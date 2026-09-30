-- The contract step for a required document_date. effective_date was a
-- generated copy of it with a UTC fallback; since 0024 no record lacks a date,
-- and the previous release reads document_date alone.
ALTER TABLE "source_documents" DROP COLUMN "effective_date";
