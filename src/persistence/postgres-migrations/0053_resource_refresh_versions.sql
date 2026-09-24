-- Replace disposable invalidation history with constant-size resource watermarks.
ALTER TABLE ledger_sync_state
  ADD COLUMN transaction_id bigint,
  ADD COLUMN categories_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN settings_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN stats_version bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Historical batches may already have been pruned. Conservatively invalidate
-- every resource for clients behind this baseline; never reset the version.
UPDATE ledger_sync_state SET categories_version = version,
  settings_version = version, stats_version = version;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION record_ledger_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_ledger_id uuid;
  change_version bigint;
  change_kind text := TG_ARGV[0];
  new_row jsonb := coalesce(to_jsonb(NEW), '{}'::jsonb);
  old_row jsonb := coalesce(to_jsonb(OLD), '{}'::jsonb);
  currency_changed boolean;
BEGIN
  target_ledger_id := CASE WHEN change_kind = 'settings'
    THEN coalesce(new_row->>'id', old_row->>'id')::uuid
    ELSE coalesce(new_row->>'ledger_id', old_row->>'ledger_id')::uuid
  END;
  IF NOT EXISTS (SELECT 1 FROM ledgers WHERE id = target_ledger_id) THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  currency_changed := change_kind = 'settings'
    AND old_row->>'main_currency' IS DISTINCT FROM new_row->>'main_currency';
  INSERT INTO ledger_sync_state(ledger_id, version, updated_at)
  VALUES (target_ledger_id, 0, now()) ON CONFLICT (ledger_id) DO NOTHING;
  -- Updating this one row serializes concurrent writers. A transaction's later
  -- triggers reuse its version and accumulate resource changes at that version.
  UPDATE ledger_sync_state SET
    version = version + CASE WHEN transaction_id = txid_current() THEN 0 ELSE 1 END,
    transaction_id = txid_current(), updated_at = now()
  WHERE ledger_id = target_ledger_id RETURNING version INTO change_version;
  UPDATE ledger_sync_state SET
    categories_version = CASE WHEN change_kind = 'category' OR currency_changed
      THEN change_version ELSE categories_version END,
    settings_version = CASE WHEN change_kind = 'settings'
      THEN change_version ELSE settings_version END,
    stats_version = CASE WHEN change_kind IN ('document', 'entry', 'category', 'settings')
      THEN change_version ELSE stats_version END
  WHERE ledger_id = target_ledger_id;
  RETURN coalesce(NEW, OLD);
END $$;
--> statement-breakpoint
DROP FUNCTION prune_ledger_change_log(uuid);
--> statement-breakpoint
DROP TABLE ledger_change_batches;
