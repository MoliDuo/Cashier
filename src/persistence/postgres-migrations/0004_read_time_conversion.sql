-- Reads now filter and total on convert_amount, so the stored amount's index
-- has nothing left to serve.
DROP INDEX "idx_ledger_entries_active_amount";
--> statement-breakpoint
-- Snapshots the previous release cached after 0003's backfill. It already
-- wrote them to both tables; this only closes any gap.
INSERT INTO exchange_rates (rate_date, currency, per_eur, source_date, fetched_at)
SELECT snapshot.date, rate.key, rate.value::numeric, NULL::date, snapshot.updated_at
FROM currency_rates snapshot
CROSS JOIN LATERAL jsonb_each_text(snapshot.rates) AS rate(key, value)
WHERE snapshot.base = 'EUR' AND rate.key ~ '^[A-Z]{3}$' AND rate.value::numeric > 0
UNION ALL
SELECT snapshot.date, 'EUR', 1::numeric, NULL::date, snapshot.updated_at
FROM currency_rates snapshot
WHERE snapshot.base = 'EUR'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Converted amounts are computed when read, so a rate that arrives or is
-- corrected changes what every ledger shows. Advance each ledger's change
-- and stats versions so open clients refetch. Ledgers are locked in id order
-- so two concurrent rate writes cannot deadlock on them.
CREATE FUNCTION record_exchange_rate_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM changed_rates) THEN
    RETURN NULL;
  END IF;
  INSERT INTO ledger_sync_state (ledger_id, version, updated_at)
  SELECT id, 0, now() FROM ledgers ORDER BY id
  ON CONFLICT (ledger_id) DO NOTHING;
  UPDATE ledger_sync_state state SET
    version = state.version + CASE WHEN state.transaction_id = txid_current() THEN 0 ELSE 1 END,
    transaction_id = txid_current(), updated_at = now()
  FROM (SELECT ledger_id FROM ledger_sync_state ORDER BY ledger_id FOR UPDATE) locked
  WHERE state.ledger_id = locked.ledger_id;
  UPDATE ledger_sync_state SET stats_version = version;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trg_exchange_rates_insert_change_log AFTER INSERT ON exchange_rates
REFERENCING NEW TABLE AS changed_rates
FOR EACH STATEMENT EXECUTE FUNCTION record_exchange_rate_change();
--> statement-breakpoint
CREATE TRIGGER trg_exchange_rates_update_change_log AFTER UPDATE ON exchange_rates
REFERENCING NEW TABLE AS changed_rates
FOR EACH STATEMENT EXECUTE FUNCTION record_exchange_rate_change();
