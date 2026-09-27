"use client";
import { useEffect, useState, type ReactNode } from "react";
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
import { DraftNotice } from "@/components/ui/draft-notice";
import { useQuickEntryFormController } from "@/modules/source-document/hooks/useQuickEntryFormController";
import { formatDateTimeForApi } from "@/lib/date-utils";
import type { CreatedRecordResult } from "@/modules/source-document/contracts";
import Link from "next/link";
import { commonCopy } from "@/copy/common";
import { quickEntryFormCopy } from "@/copy/source-document";
import { NewRecordFooter } from "./NewRecordFooter";

interface QuickEntryFormProps {
  bookId?: string;
  categories: EntryCategory[];
  mainCurrency?: string;
  preferredCurrencies?: string[];
  timeZone?: string;
  onSuccess?: (result: CreatedRecordResult) => void;
  onPendingChange?: (pending: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Shown at the start of the form's footer, beside the submit — the book picker. */
  footerStart?: ReactNode;
}

export function QuickEntryForm({
  bookId,
  categories,
  mainCurrency = "CNY",
  preferredCurrencies = [],
  timeZone,
  onSuccess,
  onPendingChange,
  onDirtyChange,
  footerStart,
}: QuickEntryFormProps) {
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
    restoredFromDraft,
    discardDraft,
  } = useQuickEntryFormController({
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
  // The errors wait for a first attempt: a form that opens already red reads as
  // a mistake the reader has not made yet.
  const [attempted, setAttempted] = useState(false);
  const showAmountError = attempted && !hasValidAmount;
  const showCategoryError = attempted && selectedCategoryId === null && categories.length > 0;

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
      className="flex min-h-full flex-1 flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!hasValidAmount || selectedCategoryId === null) {
          setAttempted(true);
          return;
        }
        handleSubmit();
      }}
    >
      {restoredFromDraft ? <DraftNotice disabled={isPending} onDiscard={discardDraft} /> : null}

      {/* The amount leads: it is the one thing every record needs. */}
      <div>
        <div className="flex items-stretch gap-2">
          <AmountInput
            value={amount}
            onChange={setAmount}
            disabled={isPending}
            aria-label={quickEntryFormCopy.amount}
            aria-invalid={showAmountError || undefined}
            aria-describedby={showAmountError ? amountErrorId : undefined}
            name="amount"
            placeholder="0.00"
            className="h-14 min-w-0 flex-1 text-right text-2xl font-semibold tabular-nums"
          />
          <Select value={currency} onValueChange={setCurrency} disabled={isPending}>
            <SelectTrigger className="h-14 w-24 shrink-0" aria-label={quickEntryFormCopy.currency}>
              <SelectValue placeholder={quickEntryFormCopy.selectCurrency} />
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
        {showAmountError ? (
          <p id={amountErrorId} className="mt-1.5 text-sm text-destructive">
            {quickEntryFormCopy.amountRequired}
          </p>
        ) : null}
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">{quickEntryFormCopy.selectCategory}</p>
        {categories.length === 0 ? (
          <div
            role="alert"
            className="mb-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm"
          >
            <p>{quickEntryFormCopy.noCategories}</p>
            <Link href="/settings" className="mt-2 inline-flex font-medium text-primary underline">
              {quickEntryFormCopy.goToSettings}
            </Link>
          </div>
        ) : null}
        <div
          className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto"
          role="group"
          aria-label={quickEntryFormCopy.selectCategory}
          aria-describedby={showCategoryError ? categoryErrorId : undefined}
        >
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              disabled={isPending}
              aria-pressed={selectedCategoryId === cat.id}
              onClick={() => setSelectedCategoryId(cat.id)}
              className={cn(
                "flex min-h-11 flex-col items-center gap-1 rounded-lg border p-2 transition-colors",
                selectedCategoryId === cat.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-text hover:bg-accent/10"
              )}
            >
              <CategoryIcon iconName={cat.icon} className="h-5 w-5" />
              <span className="w-full truncate text-center text-xs">{cat.name}</span>
            </button>
          ))}
        </div>
        {showCategoryError ? (
          <p id={categoryErrorId} className="mt-1.5 text-sm text-destructive">
            {quickEntryFormCopy.categoryRequired}
          </p>
        ) : null}
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">{quickEntryFormCopy.selectDate}</p>
        <DateFilter
          value={entryDate}
          onChange={(date) => {
            if (date != null) setEntryDate(formatDateTimeForApi(date));
          }}
          placeholder={quickEntryFormCopy.selectDate}
          size="sm"
          className="w-full"
          disabled={isPending}
        />
      </div>

      <Input
        aria-label={quickEntryFormCopy.itemName}
        name="itemName"
        autoComplete="off"
        value={itemName}
        disabled={isPending}
        onChange={(e) => setItemName(e.target.value)}
        placeholder={
          selectedCategory != null
            ? `${quickEntryFormCopy.itemNamePlaceholder}${selectedCategory.name}`
            : quickEntryFormCopy.itemName
        }
      />

      <NewRecordFooter start={footerStart}>
        <Button type="submit" disabled={isPending} className="min-w-28">
          {isPending ? (
            <>
              <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
              {commonCopy.sendingStatus}
            </>
          ) : (
            <>
              <Send aria-hidden="true" className="mr-2 h-4 w-4" />
              {quickEntryFormCopy.record}
            </>
          )}
        </Button>
      </NewRecordFooter>
    </form>
  );
}
