ALTER TABLE "source_documents" ADD COLUMN "attributed_user_id" uuid;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "service_credentials" ADD COLUMN "attributed_user_id" uuid;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_attributed_user_id_users_id_fk" FOREIGN KEY ("attributed_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "service_credentials" ADD CONSTRAINT "service_credentials_attributed_user_id_users_id_fk" FOREIGN KEY ("attributed_user_id") REFERENCES "users"("id");--> statement-breakpoint
UPDATE "source_documents" AS d SET "attributed_user_id" = l."user_id" FROM "ledgers" AS l WHERE l."id" = d."ledger_id";--> statement-breakpoint
UPDATE "service_credentials" AS c SET "attributed_user_id" = l."user_id" FROM "ledgers" AS l WHERE l."id" = c."ledger_id";--> statement-breakpoint
CREATE INDEX "idx_source_documents_ledger_attribution" ON "source_documents" ("ledger_id", "attributed_user_id") WHERE "deleted_at" IS NULL;
