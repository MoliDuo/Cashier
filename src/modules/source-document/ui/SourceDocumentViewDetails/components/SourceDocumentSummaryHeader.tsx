"use client";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, SquareDashedMousePointer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateFilter } from "@/components/ui/date-filter";
import { formatDateTimeForApi } from "@/lib/date-utils";
import type { SourceDocPendingChanges } from "@/modules/source-document/detail-types";
import { SourceDocumentTotal } from "./SourceDocumentTotal";

interface SourceDocumentSummaryHeaderProps {
  displayEntryDate: string;
  totalInMainCurrency: string;
  mainCurrency: string;
  staleConversionCount: number;
  unconvertedCount: number;
  onSourceDocChange: (changes: SourceDocPendingChanges) => void;
  fieldsDisabled: boolean;
  isInvalid: boolean;
  entryCount: number;
  isSelectionMode: boolean;
  interactionDisabled: boolean;
  onToggleSelectionMode: () => void;
  /**
   * The selection band. In selection mode it takes the row in place of the date
   * and the total, so this header reads exactly like the stream and details
   * toolbars — back control, count and batch actions on one line — instead of
   * leaving a second bar at the bottom of the modal.
   */
  selectionToolbar?: ReactNode;
}

/**
 * The document toolbar: the same shell as the ledger stream toolbar, so the
 * select control, the transaction date, and the total read the same in both.
 * The date is centred against the bar itself; the side controls never nudge it.
 * It is the header row of the entries card, so it draws only the rule below.
 */
export function SourceDocumentSummaryHeader({
  displayEntryDate,
  totalInMainCurrency,
  mainCurrency,
  staleConversionCount,
  unconvertedCount,
  onSourceDocChange,
  fieldsDisabled,
  isInvalid,
  entryCount,
  isSelectionMode,
  interactionDisabled,
  onToggleSelectionMode,
  selectionToolbar,
}: SourceDocumentSummaryHeaderProps) {
  const t = useTranslations("SourceDocumentDetail");
  const tCommon = useTranslations("Common");

  // The total's right inset matches the entry rows' `px-3` so the two line up;
  // the left keeps its own tighter inset for the select control.
  return (
    <div
      data-testid="source-document-date-row"
      className="relative flex min-w-0 items-center justify-between gap-2 border-b border-border py-2 pl-2 pr-3"
    >
      <div className="relative z-10 flex shrink-0 items-center gap-2">
        {entryCount > 0 && !interactionDisabled && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSelectionMode}
            className="shrink-0 h-8 w-8"
            aria-label={isSelectionMode ? t("cancelSelect") : t("select")}
            title={isSelectionMode ? t("cancelSelect") : t("select")}
          >
            {isSelectionMode ? (
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            ) : (
              <SquareDashedMousePointer aria-hidden="true" className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      {selectionToolbar != null ? (
        <div className="flex min-w-0 flex-1 items-center">{selectionToolbar}</div>
      ) : (
        <>
          {/* Centred on the bar itself from the sm breakpoint up; on a narrow
              screen it falls back into the flow so it cannot collide with a total
              that carries a conversion caveat. */}
          <div className="flex min-w-0 items-center gap-2 sm:absolute sm:left-1/2 sm:top-1/2 sm:max-w-[55%] sm:-translate-x-1/2 sm:-translate-y-1/2">
            {/* The bar carries no visible label; name the date for screen readers. */}
            <span className="sr-only">{t("transactionTime")}</span>
            <DateFilter
              value={displayEntryDate}
              onChange={(date) => {
                if (date) {
                  onSourceDocChange({ documentDate: formatDateTimeForApi(date) });
                }
              }}
              size="sm"
              className="min-w-fit shrink-0"
              truncate={false}
              readOnly={fieldsDisabled}
              readOnlyTextClassName="font-medium"
              hideReadOnlyIcon
            />
            {isInvalid && (
              <Badge
                variant="error"
                className="h-5 shrink-0 rounded-full px-1.5 text-xs font-medium"
              >
                {tCommon("error")}
              </Badge>
            )}
          </div>

          <SourceDocumentTotal
            totalInMainCurrency={totalInMainCurrency}
            mainCurrency={mainCurrency}
            staleConversionCount={staleConversionCount}
            unconvertedCount={unconvertedCount}
          />
        </>
      )}
    </div>
  );
}
