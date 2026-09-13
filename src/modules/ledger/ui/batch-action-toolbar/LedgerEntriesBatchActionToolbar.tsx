"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { textRoleClassName } from "@/components/typography";
import { cn } from "@/lib/utils";
import type { EntryCategory } from "@/modules/ledger/contracts";
import { BatchCategoryDialog } from "./BatchCategoryDialog";
import { BatchCurrencyDialog } from "./BatchCurrencyDialog";
import { BatchSetCategoryDialog } from "./BatchSetCategoryDialog";
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
  /** A classification run for this ledger is in flight. */
  isReclassifying?: boolean;
  /**
   * Passing this switches the category dialog from "the row you tap is applied"
   * to the confirm-based one, where several picks are a question for the model.
   * The caller owns that dialog's state, because the run it can start outlives
   * this band.
   */
  onConfirmCategory?: () => void;
  categoryDialogOpen?: boolean;
  onCategoryDialogOpenChange?: (open: boolean) => void;
  pickedCategoryIds?: readonly string[];
  /** The clear row is picked. */
  clearCategoryPicked?: boolean;
  onToggleCategoryPick?: (categoryId: string | null, picked: boolean) => void;
  /** The captured selection no longer matches the live one. */
  categorySelectionChanged?: boolean;
  isConfirmingCategory?: boolean;
  isProcessing?: boolean;
  className?: string;
}

/**
 * The one selection band. Every surface that selects rows renders this: the
 * stream and details tabs put it inside their toolbar box, and the
 * source-document detail modal puts it in the entries card's header row.
 *
 * The band prints no number. Which rows are in is already on the rows — every
 * selected card draws its own outline — and the box's three states say the rest:
 * empty for none, a mixed mark for some, a tick for all. What is left worth
 * saying is what the control does, so the box carries the words and flips from
 * `selectAll` to `deselectAll` once everything loaded is in.
 *
 * The control and the actions share one row, so the band reads as a single bar
 * next to whatever entered selection mode; only a narrow viewport wraps them.
 *
 * It renders for as long as selection mode is on, including with nothing
 * selected — otherwise the empty state has no way to select all, and the rows
 * have to be entered one at a time.
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
  isReclassifying = false,
  onConfirmCategory,
  categoryDialogOpen: categoryDialogOpenProp = false,
  onCategoryDialogOpenChange,
  pickedCategoryIds = [],
  clearCategoryPicked = false,
  onToggleCategoryPick,
  categorySelectionChanged = false,
  isConfirmingCategory = false,
  isProcessing: externallyProcessing = false,
  className,
}: LedgerEntriesBatchActionToolbarProps) {
  const t = useTranslations("BatchActions");
  const [internalChangingCategory, setInternalChangingCategory] = useState(false);
  const [internalChangingCurrency, setInternalChangingCurrency] = useState(false);
  // The band owns both pickers: the choice is one list, and every surface that
  // renders the band gets the same one without wiring up its own dialog. The
  // category dialog is the exception — the confirm-based variant is owned by
  // whichever caller can start a run from it.
  const [internalCategoryDialogOpen, setInternalCategoryDialogOpen] = useState(false);
  const [currencyDialogOpen, setCurrencyDialogOpen] = useState(false);

  const confirmsCategory = onConfirmCategory != null && onToggleCategoryPick != null;
  const categoryDialogOpen = confirmsCategory ? categoryDialogOpenProp : internalCategoryDialogOpen;
  const handleCategoryDialogOpenChange = useCallback(
    (open: boolean) => {
      if (confirmsCategory) onCategoryDialogOpenChange?.(open);
      else setInternalCategoryDialogOpen(open);
    },
    [confirmsCategory, onCategoryDialogOpenChange]
  );

  const isChangingCategory = isChangingCategoryProp ?? internalChangingCategory;
  const isChangingCurrency = isChangingCurrencyProp ?? internalChangingCurrency;
  const isProcessing =
    isChangingCategory ||
    isChangingCurrency ||
    isReclassifying ||
    isConfirmingCategory ||
    externallyProcessing;
  // Nothing selected means nothing to act on; keeping the buttons visible but
  // unavailable says what the mode offers without a layout shift on first tap.
  const actionsDisabled = isProcessing || selectedCount === 0;
  const masterChecked: boolean | "indeterminate" = isAllSelected
    ? true
    : selectedCount > 0
      ? "indeterminate"
      : false;
  // A surface that supports none of the batch writes still gets the way to
  // select all, but no empty row of buttons.
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
          // The box's own name, because the label next to it also carries the
          // loaded-scope note, which is not part of what the control is.
          aria-label={isAllSelected ? t("deselectAll") : t("selectAll")}
          className="h-4 w-4"
        />
        <span className={textRoleClassName("bodyStrong", "whitespace-nowrap")}>
          {isAllSelected ? t("deselectAll") : t("selectAll")}
        </span>
        {isAllSelected && hasMoreData ? (
          <span className="whitespace-nowrap text-xs text-muted-foreground">{t("loadedOnly")}</span>
        ) : null}
      </label>

      {hasActions ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1 sm:gap-2">
          <LedgerEntriesActions
            disabled={actionsDisabled}
            isChangingCategory={isChangingCategory}
            isChangingCurrency={isChangingCurrency}
            isRetrying={isRetrying}
            isDeleting={isDeleting}
            isReclassifying={isReclassifying}
            {...(onChangeCategory != null
              ? { onOpenCategory: () => handleCategoryDialogOpenChange(true) }
              : {})}
            {...(onChangeCurrency != null
              ? { onOpenCurrency: () => setCurrencyDialogOpen(true) }
              : {})}
            {...(onChangeDate != null ? { onChangeDate } : {})}
            {...(onRetry != null ? { onRetry } : {})}
            {...(onSplit != null ? { onSplit } : {})}
            {...(onDelete != null ? { onDelete } : {})}
          />
        </div>
      ) : null}

      {onChangeCategory != null && confirmsCategory ? (
        <BatchSetCategoryDialog
          open={categoryDialogOpen}
          onOpenChange={handleCategoryDialogOpenChange}
          categories={categories}
          selectedCount={selectedCount}
          pickedCategoryIds={pickedCategoryIds}
          clearPicked={clearCategoryPicked}
          onTogglePick={onToggleCategoryPick}
          selectionChanged={categorySelectionChanged}
          isConfirming={isConfirmingCategory}
          onConfirm={onConfirmCategory}
        />
      ) : null}
      {onChangeCategory != null && !confirmsCategory ? (
        <BatchCategoryDialog
          open={categoryDialogOpen}
          onOpenChange={handleCategoryDialogOpenChange}
          categories={categories}
          onSelect={(categoryId) => void handleChangeCategory(categoryId)}
        />
      ) : null}
      {onChangeCurrency != null ? (
        <BatchCurrencyDialog
          open={currencyDialogOpen}
          onOpenChange={setCurrencyDialogOpen}
          preferredCurrencies={preferredCurrencies}
          onSelect={(currency) => void handleChangeCurrency(currency)}
        />
      ) : null}
    </div>
  );
}
