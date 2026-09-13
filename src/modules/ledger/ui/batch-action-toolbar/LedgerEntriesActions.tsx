import { Calendar, DollarSign, RefreshCw, Scissors, Sparkles, Tag, Trash2 } from "lucide-react";
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
  isReclassifying?: boolean;
  /** Opens the dialog that picks a category; the choice itself belongs to the
   * band, which owns the list. */
  onOpenCategory?: () => void;
  /** Opens the dialog that picks which categories the model may choose from. */
  onOpenAiCategory?: () => void;
  onOpenCurrency?: () => void;
  onChangeDate?: () => void;
  onRetry?: () => void;
  onSplit?: () => void;
  onDelete?: () => void;
}

/**
 * The batch action row, in one order everywhere: category, AI category, date,
 * split, retry, currency, delete. A surface renders only the actions its
 * entities support, so the subsets still line up — every view puts delete last.
 *
 * Every action opens something: a dialog for the four that pick a value, a
 * confirm for the two that write. Nothing here is a menu, so nothing here
 * carries a chevron.
 */
export function LedgerEntriesActions({
  disabled,
  isChangingCategory = false,
  isChangingCurrency = false,
  isRetrying = false,
  isDeleting = false,
  isReclassifying = false,
  onOpenCategory,
  onOpenAiCategory,
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
          loading={isChangingCategory}
          shortLabel={t("manualCategoryShort")}
          onClick={onOpenCategory}
        >
          {t("manualCategory")}
        </BatchActionButton>
      )}

      {onOpenAiCategory != null && (
        <BatchActionButton
          variant="outline"
          icon={Sparkles}
          disabled={disabled}
          loading={isReclassifying}
          shortLabel={t("aiCategoryShort")}
          onClick={onOpenAiCategory}
        >
          {t("aiCategory")}
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
