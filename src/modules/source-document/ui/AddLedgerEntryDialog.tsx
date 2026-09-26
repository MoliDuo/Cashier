"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EntryCategory } from "@/modules/ledger/contracts";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import type { AddEntryData } from "@/modules/source-document/detail-types";

interface AddLedgerEntryDialogProps {
  open: boolean;
  categories: EntryCategory[];
  preferredCurrencies?: string[];
  mainCurrency?: string;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: AddEntryData) => Promise<boolean>;
}

export function AddLedgerEntryDialog({
  open,
  categories,
  preferredCurrencies = [],
  mainCurrency = "CNY",
  isSubmitting,
  onOpenChange,
  onSubmit,
}: AddLedgerEntryDialogProps) {
  const t = useTranslations("SourceDocumentDetail");
  const tCommon = useTranslations("Common");
  const [itemName, setItemName] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [currency, setCurrency] = useState<string>(mainCurrency);

  const numericAmount = parseFloat(amount);
  const canSubmit = itemName.trim() !== "" && Number.isFinite(numericAmount) && numericAmount > 0;

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return;

    try {
      const submitted = await onSubmit({
        itemName: itemName.trim(),
        amount: Math.round(numericAmount * 100) / 100,
        ...(categoryId !== "" ? { categoryId } : {}),
        ...(currency !== "" ? { currency } : {}),
      });
      if (!submitted) return;
      setItemName("");
      setAmount("");
      setCategoryId("");
      setCurrency(mainCurrency);
      onOpenChange(false);
    } catch {
      // The parent mutation owns failure feedback.
    }
  };

  const sortedCurrencies = [
    ...preferredCurrencies.filter((c) => c !== "unknown"),
    ...SUPPORTED_CURRENCIES.filter((c) => !preferredCurrencies.includes(c)).sort(),
  ];

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <DialogContent
        variant="modal"
        className="sm:max-w-md"
        hideCloseButton={isSubmitting}
        onEscapeKeyDown={(event) => isSubmitting && event.preventDefault()}
        onPointerDownOutside={(event) => isSubmitting && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-4" />
            {t("addEntryTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="add-entry-name">{t("addEntryName")}</Label>
            <Input
              id="add-entry-name"
              name="itemName"
              autoComplete="off"
              value={itemName}
              disabled={isSubmitting}
              autoFocus
              placeholder={t("addEntryNamePlaceholder")}
              onChange={(event) => setItemName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="add-entry-amount">{t("addEntryAmount")}</Label>
            <AmountInput
              id="add-entry-amount"
              name="amount"
              value={amount}
              onChange={setAmount}
              disabled={isSubmitting}
              placeholder="0.00"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("addEntryCategory")}</Label>
              <Select value={categoryId} onValueChange={setCategoryId} disabled={isSubmitting}>
                <SelectTrigger aria-label={t("addEntryCategory")} className="w-full">
                  <SelectValue placeholder={t("addEntryNoCategory")} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t("addEntryCurrency")}</Label>
              <Select value={currency} onValueChange={setCurrency} disabled={isSubmitting}>
                <SelectTrigger aria-label={t("addEntryCurrency")} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sortedCurrencies.map((curr) => (
                    <SelectItem key={curr} value={curr}>
                      {curr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button disabled={!canSubmit || isSubmitting} onClick={handleSubmit}>
            {isSubmitting ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Plus aria-hidden="true" className="size-4" />
            )}
            {t("addEntryTitle")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
