DO $$
DECLARE
  missing_documents bigint;
  missing_credentials bigint;
BEGIN
  SELECT count(*) INTO missing_documents FROM source_documents WHERE attributed_user_id IS NULL;
  SELECT count(*) INTO missing_credentials FROM service_credentials WHERE attributed_user_id IS NULL;
  IF missing_documents <> 0 OR missing_credentials <> 0 THEN
    RAISE EXCEPTION 'Couple attribution incomplete: % documents and % credentials',
      missing_documents, missing_credentials;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "service_credentials" ALTER COLUMN "attributed_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "source_documents" ALTER COLUMN "attributed_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "registration_completed_at";
