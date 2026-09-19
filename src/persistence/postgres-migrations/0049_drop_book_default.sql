-- The 总账 default book is gone.
--
-- `books.is_default` marked the book that records entered while viewing 总账
-- landed in, and doubled as 总账's time zone and as a book that could not be
-- archived or deleted. 总账 turns out to need none of that: it is a virtual
-- view over every book, it needs no designated member, records entered from it
-- now go to the book the device last picked, and 总账's dates follow the
-- device's zone. The flag only ever said "this row is special" in a way the UI
-- kept having to explain away, so the column and its uniqueness index are
-- dropped rather than reinterpreted.
--
-- 0048 still sets the flag on 共同支出 when it creates the books; dropping the
-- column here afterwards makes that write harmless history.
DROP INDEX "uniq_books_default";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "is_default";
