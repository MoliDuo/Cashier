"use client";
import { useTranslations } from "next-intl";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { AmountText } from "@/modules/currency/ui/amount-text";
import { DISPLAY_LOCALE } from "@/lib/constants";

interface SourceDocumentTotalProps {
  totalInMainCurrency: string;
  mainCurrency: string;
  staleConversionCount: number;
  unconvertedCount: number;
}

/**
 * The document total: a bare amount, matching the ledger stream toolbar's
 * total, followed by any caveat about the conversion.
 */
export function SourceDocumentTotal({
  totalInMainCurrency,
  mainCurrency,
  staleConversionCount,
  unconvertedCount,
}: SourceDocumentTotalProps) {
  const t = useTranslations("SourceDocumentDetail");
  const tCommon = useTranslations("Common");
  const locale = DISPLAY_LOCALE;
  const amount = formatCurrencyAmount(totalInMainCurrency, mainCurrency, locale);

  return (
    <div className="relative z-10 flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <AmountText variant="summary" className="whitespace-nowrap">
        {staleConversionCount > 0 ? "≈ " : ""}
        {amount}
      </AmountText>
      {unconvertedCount > 0 ? (
        <span className="text-xs text-warning" role="status">
          {tCommon("incompleteAccountingProjection")}
        </span>
      ) : staleConversionCount > 0 ? (
        <span className="text-xs text-muted-foreground" role="status">
          {t("pendingRecalculation")}
        </span>
      ) : null}
    </div>
  );
}
