-- Historical revision numbers and origins remain available for audit.
-- New revisions are identified by UUID; document.version controls concurrent edits.
ALTER TABLE source_document_revisions ALTER COLUMN revision_number DROP NOT NULL;
