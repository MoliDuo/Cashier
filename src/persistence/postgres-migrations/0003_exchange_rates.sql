CREATE TABLE "exchange_rates" (
	"rate_date" date NOT NULL,
	"currency" varchar(3) NOT NULL,
	"per_eur" numeric NOT NULL,
	"source_date" date,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_rate_date_currency_pk" PRIMARY KEY("rate_date","currency"),
	CONSTRAINT "ck_exchange_rates_per_eur_positive" CHECK ("exchange_rates"."per_eur" > 0)
);
--> statement-breakpoint
-- Every cached snapshot is euro-based; unpacking another base as per-euro
-- rates would silently mis-convert, so a stray row stops the deploy instead.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM currency_rates WHERE base <> 'EUR') THEN
    RAISE EXCEPTION 'currency_rates holds a snapshot whose base is not EUR';
  END IF;
END
$$;
--> statement-breakpoint
-- The old cache recorded neither the provider's own date nor a separate fetch
-- time, so source_date stays unknown and fetched_at is when the row was
-- written. A row written before its day was over counts as provisional.
INSERT INTO exchange_rates (rate_date, currency, per_eur, source_date, fetched_at)
SELECT snapshot.date, rate.key, rate.value::numeric, NULL::date, snapshot.updated_at
FROM currency_rates snapshot
CROSS JOIN LATERAL jsonb_each_text(snapshot.rates) AS rate(key, value)
WHERE rate.key ~ '^[A-Z]{3}$' AND rate.value::numeric > 0
UNION ALL
SELECT snapshot.date, 'EUR', 1::numeric, NULL::date, snapshot.updated_at
FROM currency_rates snapshot
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Minor-unit places per ISO 4217, kept in step with getCurrencyDecimals.
CREATE FUNCTION currency_decimals(currency text) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN currency IN ('JPY', 'KRW', 'VND', 'CLP', 'COP', 'ISK') THEN 0
    WHEN currency IN ('BHD', 'JOD', 'KWD', 'OMR', 'TND') THEN 3
    ELSE 2
  END
$$;
--> statement-breakpoint
-- Units of to_currency per unit of from_currency on a day, rounded to 20
-- places like the application's divide(); null when either rate is missing.
-- The dividend is widened to 40 places first so the division is not cut at
-- numeric's default 16 significant digits.
CREATE FUNCTION exchange_ratio(from_currency text, to_currency text, on_date date)
RETURNS numeric
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN from_currency = to_currency THEN 1::numeric
    ELSE (
      SELECT round(target.per_eur::numeric(80, 40) / source.per_eur, 20)
      FROM exchange_rates source
      JOIN exchange_rates target
        ON target.rate_date = source.rate_date AND target.currency = to_currency
      WHERE source.rate_date = on_date AND source.currency = from_currency
    )
  END
$$;
--> statement-breakpoint
-- The one conversion every read uses: the amount in to_currency at the day's
-- rate, rounded half away from zero to that currency's minor unit.
CREATE FUNCTION convert_amount(amount numeric, from_currency text, to_currency text, on_date date)
RETURNS numeric
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT round(amount * exchange_ratio(from_currency, to_currency, on_date),
                currency_decimals(to_currency))
$$;
