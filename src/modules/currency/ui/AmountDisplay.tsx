"use client";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { useAmountDisplay } from "@/modules/currency/hooks/useAmountDisplay";
import { AmountText, type AmountVariant } from "./amount-text";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { currencyCopy } from "@/copy/common";

interface AmountDisplayProps {
  amount: string;
  currency: string | null | undefined;
  mainCurrency: string;
  date?: string | null;
  persistedConvertedAmount?: string | null;
  className?: string;
  variant?: AmountVariant;
  showOriginal?: boolean;
}

export function AmountDisplay({
  amount,
  currency,
  mainCurrency,
  date,
  persistedConvertedAmount,
  className = "",
  variant = "item",
  showOriginal = true,
}: AmountDisplayProps) {
  const locale = DISPLAY_LOCALE;
  const { displayAmount, isDifferentCurrency, originalCurrency, status } = useAmountDisplay({
    amount,
    currency,
    mainCurrency,
    ...(date != null ? { date } : {}),
    ...(persistedConvertedAmount != null ? { persistedConvertedAmount } : {}),
  });

  const showConverted = isDifferentCurrency && status === "success";
  const displayCurrency = showConverted ? mainCurrency : originalCurrency;
  const currencyDisplay = isDifferentCurrency && !showConverted ? "code" : "narrowSymbol";

  return (
    <div
      className={`flex flex-col items-end ${className}`}
      aria-live="polite"
      aria-atomic="true"
      {...(status === "loading" ? { "aria-busy": true } : {})}
    >
      <AmountText variant={variant}>
        {formatCurrencyAmount(displayAmount, displayCurrency, locale, { currencyDisplay })}
      </AmountText>
      {showConverted && showOriginal ? (
        <AmountText variant="secondary">
          {formatCurrencyAmount(amount, originalCurrency, locale, { currencyDisplay: "code" })}
        </AmountText>
      ) : null}
      {status === "error" ? (
        <span className="text-xs font-normal text-muted-foreground">
          {currencyCopy.conversionUnavailable}
        </span>
      ) : null}
    </div>
  );
}
