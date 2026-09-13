"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { EntryCategory } from "@/modules/ledger/contracts";
import { LedgerEntriesActions } from "./LedgerEntriesActions";

export interface LedgerEntriesBatchActionToolbarProps {
  selectedCount: number;
  isAllSelected: boolean;
  hasMoreData?: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  categories?: EntryCategory[];
  preferredCurrencies?: string[];
  isChangingCategory?: boolean;
  isChangingCurrency?: boolean;
  onChangeCategory?: (categoryId: string | null) => Promise<void> | void;
  onChangeCurrency?: (currency: string) => Promise<void> | void;
  onChangeDate?: () => void;
  onRetry?: () => void;
  isRetrying?: boolean;
  onSplit?: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
  isProcessing?: boolean;
  className?: string;
}

/**
 * The one selection band. Every surface that selects rows renders this: the
 * stream and details tabs put it inside their toolbar box, and the
 * source-document detail modal puts it above its footer.
 *
 * The count and the actions share one row, so the band reads as a single bar
 * next to whatever entered selection mode; only a narrow viewport wraps them.
 *
 * It renders for as long as selection mode is on, including with nothing
 * selected — otherwise the empty state has no count and no way to select all,
 * and the row has to be entered one row at a time.
 */
export function LedgerEntriesBatchActionToolbar({
  selectedCount,
  isAllSelected,
  hasMoreData = false,
  onSelectAll,
  onClearSelection,
  categories = [],
  preferredCurrencies = [],
  isChangingCategory: isChangingCategoryProp,
  isChangingCurrency: isChangingCurrencyProp,
  onChangeCategory,
  onChangeCurrency,
  onChangeDate,
  onRetry,
  isRetrying = false,
  onSplit,
  onDelete,
  isDeleting = false,
  isProcessing: externallyProcessing = false,
  className,
}: LedgerEntriesBatchActionToolbarProps) {
  const t = useTranslations("BatchActions");
  const [internalChangingCategory, setInternalChangingCategory] = useState(false);
  const [internalChangingCurrency, setInternalChangingCurrency] = useState(false);

  const isChangingCategory = isChangingCategoryProp ?? internalChangingCategory;
  const isChangingCurrency = isChangingCurrencyProp ?? internalChangingCurrency;
  const isProcessing = isChangingCategory || isChangingCurrency || externallyProcessing;
  // Nothing selected means nothing to act on; keeping the buttons visible but
  // unavailable says what the mode offers without a layout shift on first tap.
  const actionsDisabled = isProcessing || selectedCount === 0;
  const masterChecked: boolean | "indeterminate" = isAllSelected
    ? true
    : selectedCount > 0
      ? "indeterminate"
      : false;
  // A surface that supports none of the batch writes still gets the count and
  // the way to select all, but no empty row of buttons.
  const hasActions =
    onChangeCategory != null ||
    onChangeCurrency != null ||
    onChangeDate != null ||
    onRetry != null ||
    onSplit != null ||
    onDelete != null;

  const handleChangeCategory = useCallback(
    async (categoryId: string | null) => {
      if (!onChangeCategory) return;

      if (isChangingCategoryProp === undefined) {
        setInternalChangingCategory(true);
        try {
          await onChangeCategory(categoryId);
        } finally {
          setInternalChangingCategory(false);
        }
        return;
      }

      await onChangeCategory(categoryId);
    },
    [isChangingCategoryProp, onChangeCategory]
  );

  const handleChangeCurrency = useCallback(
    async (currency: string) => {
      if (!onChangeCurrency) return;

      if (isChangingCurrencyProp === undefined) {
        setInternalChangingCurrency(true);
        try {
          await onChangeCurrency(currency);
        } finally {
          setInternalChangingCurrency(false);
        }
        return;
      }

      await onChangeCurrency(currency);
    },
    [isChangingCurrencyProp, onChangeCurrency]
  );

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <label className="flex min-w-0 items-center gap-2">
        <Checkbox
          checked={masterChecked}
          disabled={isProcessing}
          onCheckedChange={(checked) => {
            if (checked === true) onSelectAll();
            else onClearSelection();
          }}
          aria-label={isAllSelected ? t("deselectAll") : t("selectAll")}
          className="h-4 w-4"
        />
        <span aria-live="polite" className="whitespace-nowrap text-xs font-medium sm:text-sm">
          {t("selectedCount", { count: selectedCount })}
        </span>
        {isAllSelected && hasMoreData ? (
          <span className="whitespace-nowrap text-xs text-muted-foreground">{t("loadedOnly")}</span>
        ) : null}
      </label>

      {hasActions ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1 sm:gap-2">
          <LedgerEntriesActions
            categories={categories}
            preferredCurrencies={preferredCurrencies}
            disabled={actionsDisabled}
            isChangingCategory={isChangingCategory}
            isChangingCurrency={isChangingCurrency}
            isRetrying={isRetrying}
            isDeleting={isDeleting}
            {...(onChangeCategory != null ? { onChangeCategory: handleChangeCategory } : {})}
            {...(onChangeCurrency != null ? { onChangeCurrency: handleChangeCurrency } : {})}
            {...(onChangeDate != null ? { onChangeDate } : {})}
            {...(onRetry != null ? { onRetry } : {})}
            {...(onSplit != null ? { onSplit } : {})}
            {...(onDelete != null ? { onDelete } : {})}
          />
        </div>
      ) : null}
    </div>
  );
}
