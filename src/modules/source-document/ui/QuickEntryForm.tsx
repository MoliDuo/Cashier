"use client";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryIcon } from "@/components/CategoryIcon";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import { cn } from "@/lib/utils";
import { Loader2, Send } from "lucide-react";
import type { EntryCategory } from "@/modules/ledger/contracts";
import { DateFilter } from "@/components/ui/date-filter";
import { useQuickEntryFormController } from "@/modules/source-document/hooks/useQuickEntryFormController";
import { formatDateTimeForApi } from "@/lib/date-utils";
import type { CreatedRecordResult } from "@/modules/source-document/contracts";
import { Link } from "@/i18n/routing";

interface QuickEntryFormProps {
  ledgerId: string;
  bookId?: string;
  categories: EntryCategory[];
  mainCurrency?: string;
  preferredCurrencies?: string[];
  timeZone?: string;
  onSuccess?: (result: CreatedRecordResult) => void;
  onPendingChange?: (pending: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function QuickEntryForm({
  ledgerId,
  bookId,
  categories,
  mainCurrency = "CNY",
  preferredCurrencies = [],
  timeZone,
  onSuccess,
  onPendingChange,
  onDirtyChange,
}: QuickEntryFormProps) {
  const tCommon = useTranslations("Common");
  const t = useTranslations("QuickEntryForm");
  const {
    selectedCategoryId,
    setSelectedCategoryId,
    selectedCategory,
    amount,
    setAmount,
    currency,
    setCurrency,
    itemName,
    setItemName,
    entryDate,
    setEntryDate,
    mutation,
    handleSubmit,
    isDirty,
  } = useQuickEntryFormController({
    ledgerId,
    ...(bookId == null ? {} : { bookId }),
    categories,
    mainCurrency,
    ...(timeZone != null ? { timeZone } : {}),
    ...(onSuccess !== undefined ? { onSuccess } : {}),
  });

  const preferredCurrencyOptions = Array.from(
    new Set(preferredCurrencies.filter((curr) => curr !== "unknown" && curr !== mainCurrency))
  );
  const currencyOptions = [
    mainCurrency,
    ...preferredCurrencyOptions,
    ...SUPPORTED_CURRENCIES.filter(
      (curr) => curr !== mainCurrency && !preferredCurrencyOptions.includes(curr)
    ),
  ];
  const parsedAmount = Number(amount);
  const hasValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const isPending = mutation.isPending;
  const amountErrorId = "quick-entry-amount-required";
  const categoryErrorId = "quick-entry-category-required";

  useEffect(() => {
    onPendingChange?.(isPending);
    return () => onPendingChange?.(false);
  }, [isPending, onPendingChange]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
    >
      {/* Item Name (optional) */}
      <Input
        aria-label={t("itemName")}
        name="itemName"
        autoComplete="off"
        value={itemName}
        disabled={isPending}
        onChange={(e) => setItemName(e.target.value)}
        placeholder={
          selectedCategory != null
            ? `${t("itemNamePlaceholder")}${selectedCategory.name}`
            : t("itemName")
        }
        className="text-sm"
      />

      {/* Date Selector */}
      <div>
        <p className="text-sm text-muted-foreground mb-2">{t("selectDate")}</p>
        <DateFilter
          value={entryDate}
          onChange={(date) => {
            if (date != null) setEntryDate(formatDateTimeForApi(date));
          }}
          placeholder={t("selectDate")}
          size="sm"
          className="w-full"
          disabled={isPending}
        />
      </div>

      {/* Category Grid */}
      <div>
        <p className="text-sm text-muted-foreground mb-2">{t("selectCategory")}</p>
        {categories.length === 0 ? (
          <div
            role="alert"
            className="mb-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm"
          >
            <p>{t("noCategories")}</p>
            <Link
              href="/?tab=settings"
              className="mt-2 inline-flex font-medium text-primary underline"
            >
              {t("goToSettings")}
            </Link>
          </div>
        ) : null}
        <div
          className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto"
          role="group"
          aria-label={t("selectCategory")}
        >
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              disabled={isPending}
              onClick={() => setSelectedCategoryId(cat.id)}
              className={cn(
                "flex min-h-11 flex-col items-center gap-1 rounded-lg border p-2 transition-colors",
                selectedCategoryId === cat.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-accent/10 text-text"
              )}
            >
              <CategoryIcon iconName={cat.icon} className="h-5 w-5" />
              <span className="text-xs truncate w-full text-center">{cat.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm text-muted-foreground mb-2">{t("currency")}</p>
        <Select value={currency} onValueChange={setCurrency} disabled={isPending}>
          <SelectTrigger className="w-full" aria-label={t("currency")}>
            <SelectValue placeholder={t("selectCurrency")} />
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4}>
            {currencyOptions.map((curr) => (
              <SelectItem key={curr} value={curr}>
                {curr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Amount */}
      <div>
        <p className="mb-2 text-sm text-muted-foreground">{t("amount")}</p>
        <div className="relative">
          <AmountInput
            value={amount}
            onChange={setAmount}
            disabled={isPending}
            aria-label={t("amount")}
            name="amount"
            placeholder="0.00"
            className="h-12 pr-16 text-right text-lg font-semibold tabular-nums"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium text-muted-foreground">
            {currency}
          </span>
        </div>
      </div>

      {/* Submit */}
      <Button
        type="submit"
        disabled={selectedCategoryId === null || !hasValidAmount || isPending}
        aria-describedby={
          [
            !hasValidAmount ? amountErrorId : null,
            selectedCategoryId === null ? categoryErrorId : null,
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
        className="w-full"
      >
        {isPending ? (
          <>
            <Loader2 aria-hidden="true" className="h-4 w-4 mr-2 animate-spin" />
            {tCommon("sending_status")}
          </>
        ) : (
          <>
            <Send aria-hidden="true" className="h-4 w-4 mr-2" />
            {t("record")}
          </>
        )}
      </Button>
      {!hasValidAmount ? (
        <p id={amountErrorId} className="text-sm text-destructive">
          {t("amountRequired")}
        </p>
      ) : null}
      {selectedCategoryId === null && categories.length > 0 ? (
        <p id={categoryErrorId} className="text-sm text-destructive">
          {t("categoryRequired")}
        </p>
      ) : null}
    </form>
  );
}
