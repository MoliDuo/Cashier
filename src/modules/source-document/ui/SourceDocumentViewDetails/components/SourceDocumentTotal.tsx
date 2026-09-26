"use client";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { AmountText } from "@/modules/currency/ui/amount-text";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { commonCopy } from "@/copy/common";
import { sourceDocumentDetailCopy } from "@/copy/source-document";

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
          {commonCopy.incompleteAccountingProjection}
        </span>
      ) : staleConversionCount > 0 ? (
        <span className="text-xs text-muted-foreground" role="status">
          {sourceDocumentDetailCopy.pendingRecalculation}
        </span>
      ) : null}
    </div>
  );
}
