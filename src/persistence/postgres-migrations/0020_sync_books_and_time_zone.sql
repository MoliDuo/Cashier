-- The browser refreshes when the ledger's sync version moves, so every change
-- another device can make and this one shows has to move it: the ledger's zone
-- (it changes what every period means), the books, and the API keys. A key's
-- last_used_at is not one of them; it changes on every upload.
DROP TRIGGER IF EXISTS trg_ledgers_settings_change_log ON ledgers;--> statement-breakpoint
CREATE TRIGGER trg_ledgers_settings_change_log
  AFTER UPDATE OF ai_language, preferred_currencies, main_currency, collapse_entries_default,
    ai_custom_prompt, time_zone
  ON ledgers FOR EACH ROW EXECUTE FUNCTION record_ledger_change('settings');--> statement-breakpoint
CREATE TRIGGER trg_books_change_log
  AFTER INSERT OR DELETE OR UPDATE OF name, sort_order, archived_at
  ON books FOR EACH ROW EXECUTE FUNCTION record_ledger_change('book');--> statement-breakpoint
CREATE TRIGGER trg_service_credentials_change_log
  AFTER INSERT OR DELETE OR UPDATE OF name, book_id, revoked_at
  ON service_credentials FOR EACH ROW EXECUTE FUNCTION record_ledger_change('credential');
