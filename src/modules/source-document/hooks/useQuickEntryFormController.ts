"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { formatDateTimeForApi, getDateInTimezone } from "@/lib/date-utils";
import { createQuickEntryAction } from "@/modules/source-document/server-actions/quick-entry";
import type { EntryCategory } from "@/modules/ledger/contracts";
import type { CreatedRecordResult } from "@/modules/source-document/contracts";

interface UseQuickEntryFormControllerParams {
  ledgerId: string;
  attributedUserId?: string;
  categories: EntryCategory[];
  mainCurrency: string;
  timeZone?: string;
  onSuccess?: (result: CreatedRecordResult) => void;
}

interface CreateQuickEntryPayload {
  attributedUserId?: string;
  categoryId: string;
  amount: string;
  currency: string;
  itemName?: string;
  entryDate: string;
}

export function useQuickEntryFormController({
  ledgerId,
  attributedUserId,
  categories,
  mainCurrency,
  timeZone,
  onSuccess,
}: UseQuickEntryFormControllerParams) {
  const t = useTranslations("QuickEntryForm");
  const tCommon = useTranslations("Common");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [currencyDraft, setCurrencyDraft] = useState(() => ({
    mainCurrency,
    value: mainCurrency,
  }));
  const [itemName, setItemName] = useState("");
  const [editedEntryDate, setEditedEntryDate] = useState<string | null>(null);
  const currency = currencyDraft.mainCurrency === mainCurrency ? currencyDraft.value : mainCurrency;
  const entryDate =
    editedEntryDate ?? getDateInTimezone(timeZone) ?? formatDateTimeForApi(new Date());

  const setCurrency = useCallback(
    (value: string) => setCurrencyDraft({ mainCurrency, value }),
    [mainCurrency]
  );

  const setEntryDate = useCallback((date: string) => {
    setEditedEntryDate(date);
  }, []);

  const selectedCategory = categories.find((category) => category.id === selectedCategoryId);

  const mutation = useLedgerMutation<
    Awaited<ReturnType<typeof createQuickEntryAction>>,
    CreateQuickEntryPayload
  >(ledgerId, {
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: (data: CreateQuickEntryPayload) => createQuickEntryAction(ledgerId, data),
    invalidationErrorMessage: tCommon("savedRefreshFailed"),
    successMessage: null,
    errorMessage: t("quickEntryError"),
    onSuccess: (data, variables) => {
      setSelectedCategoryId(null);
      setAmount("");
      setCurrencyDraft({ mainCurrency, value: mainCurrency });
      setItemName("");
      setEditedEntryDate(null);
      onSuccess?.({
        sourceDocumentId: data.sourceDocumentId,
        documentDate: variables.entryDate,
      });
    },
  });

  const handleSubmit = () => {
    const parsedAmount = Number(amount);
    if (selectedCategoryId === null || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return;
    const nextItemName = itemName !== "" ? itemName : undefined;
    mutation.mutate({
      ...(attributedUserId == null ? {} : { attributedUserId }),
      categoryId: selectedCategoryId,
      amount,
      currency,
      entryDate,
      ...(nextItemName !== undefined ? { itemName: nextItemName } : {}),
    });
  };

  const isDirty =
    selectedCategoryId != null ||
    amount !== "" ||
    itemName !== "" ||
    currency !== mainCurrency ||
    editedEntryDate != null;

  return {
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
  };
}
