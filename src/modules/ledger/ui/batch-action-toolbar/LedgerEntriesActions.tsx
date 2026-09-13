import { Calendar, DollarSign, RefreshCw, Scissors, Tag, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { BatchActionButton } from "@/components/batch-action-button";

interface LedgerEntriesActionsProps {
  /** Every action is unavailable, either because a write is running or because
   * the selection is empty. */
  disabled: boolean;
  isChangingCategory?: boolean;
  isChangingCurrency?: boolean;
  isRetrying?: boolean;
  isDeleting?: boolean;
  /** An AI classification run for this ledger is in flight. */
  isReclassifying?: boolean;
  /** Opens the dialog that decides the category: one pick sets it, several ask
   * the model. The choice itself belongs to the band, which owns the list. */
  onOpenCategory?: () => void;
  onOpenCurrency?: () => void;
  onChangeDate?: () => void;
  onRetry?: () => void;
  onSplit?: () => void;
  onDelete?: () => void;
}

/**
 * The batch action row, in one order everywhere: category, date, split, retry,
 * currency, delete. A surface renders only the actions its entities support, so
 * the subsets still line up — every view puts delete last.
 *
 * Every action opens something: a dialog for the four that pick a value, a
 * confirm for the two that write. Nothing here is a menu, so nothing here
 * carries a chevron.
 *
 * Category is one button whether the answer is the user's or the model's —
 * which of the two it turns out to be is decided inside the dialog, by how many
 * categories are picked.
 */
export function LedgerEntriesActions({
  disabled,
  isChangingCategory = false,
  isChangingCurrency = false,
  isRetrying = false,
  isDeleting = false,
  isReclassifying = false,
  onOpenCategory,
  onOpenCurrency,
  onChangeDate,
  onRetry,
  onSplit,
  onDelete,
}: LedgerEntriesActionsProps) {
  const t = useTranslations("BatchActions");

  return (
    <>
      {onOpenCategory != null && (
        <BatchActionButton
          variant="outline"
          icon={Tag}
          disabled={disabled}
          loading={isChangingCategory || isReclassifying}
          shortLabel={t("manualCategoryShort")}
          onClick={onOpenCategory}
        >
          {t("manualCategory")}
        </BatchActionButton>
      )}

      {onChangeDate != null && (
        <BatchActionButton
          variant="outline"
          icon={Calendar}
          disabled={disabled}
          shortLabel={t("setDateShort")}
          onClick={onChangeDate}
        >
          {t("setDate")}
        </BatchActionButton>
      )}
      {onSplit != null && (
        <BatchActionButton variant="outline" icon={Scissors} disabled={disabled} onClick={onSplit}>
          {t("split")}
        </BatchActionButton>
      )}
      {onRetry != null && (
        <BatchActionButton
          variant="outline"
          icon={RefreshCw}
          disabled={disabled}
          loading={isRetrying}
          onClick={onRetry}
        >
          {t("retry")}
        </BatchActionButton>
      )}

      {onOpenCurrency != null && (
        <BatchActionButton
          variant="outline"
          icon={DollarSign}
          disabled={disabled}
          loading={isChangingCurrency}
          shortLabel={t("setCurrencyShort")}
          onClick={onOpenCurrency}
        >
          {t("setCurrency")}
        </BatchActionButton>
      )}

      {onDelete != null && (
        <BatchActionButton
          variant="destructive"
          icon={Trash2}
          disabled={disabled}
          loading={isDeleting}
          onClick={onDelete}
        >
          {t("delete")}
        </BatchActionButton>
      )}
    </>
  );
}
