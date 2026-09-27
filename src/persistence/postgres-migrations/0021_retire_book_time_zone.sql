-- The contract step for the ledger's one time zone (0019). The previous release
-- stopped reading and writing books.time_zone, so nothing serving traffic while
-- this runs still uses it.
ALTER TABLE "books" DROP CONSTRAINT "ck_books_time_zone_length";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "time_zone";
