"use client";

import { useCallback, useEffect, useState } from "react";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { formatDateTimeForApi, getDateInTimezone } from "@/lib/date-utils";
import { createQuickEntryAction } from "@/modules/source-document/server-actions/quick-entry";
import type { EntryCategory } from "@/modules/ledger/contracts";
import type { CreatedRecordResult } from "@/modules/source-document/contracts";
import { clearDraft, draftKey, readDraft, writeDraft } from "@/lib/drafts";
import { useLedgerId } from "@/modules/ledger/hooks/useLedgerId";
import { quickEntryFormCopy } from "@/copy/source-document";

interface UseQuickEntryFormControllerParams {
  bookId?: string;
  categories: EntryCategory[];
  mainCurrency: string;
  timeZone?: string;
  onSuccess?: (result: CreatedRecordResult) => void;
}

interface CreateQuickEntryPayload {
  bookId?: string;
  categoryId: string;
  amount: string;
  currency: string;
  itemName?: string;
  entryDate: string;
}

interface QuickEntryDraft {
  categoryId: string | null;
  amount: string;
  currency: string;
  itemName: string;
  entryDate: string | null;
}

function parseQuickEntryDraft(data: unknown): QuickEntryDraft | null {
  if (data == null || typeof data !== "object") return null;
  const { categoryId, amount, currency, itemName, entryDate } = data as Record<string, unknown>;
  const isNullableString = (value: unknown) => value === null || typeof value === "string";
  if (
    !isNullableString(categoryId) ||
    typeof amount !== "string" ||
    typeof currency !== "string" ||
    typeof itemName !== "string" ||
    !isNullableString(entryDate)
  ) {
    return null;
  }
  return {
    categoryId: categoryId as string | null,
    amount,
    currency,
    itemName,
    entryDate: entryDate as string | null,
  };
}

export function useQuickEntryFormController({
  bookId,
  categories,
  mainCurrency,
  timeZone,
  onSuccess,
}: UseQuickEntryFormControllerParams) {
  const ledgerId = useLedgerId();
  const key = ledgerId == null ? null : draftKey(ledgerId, "new-record-quick", "new");
  const [restored] = useState(() =>
    key == null ? null : (readDraft(key, parseQuickEntryDraft)?.data ?? null)
  );
  const [restoredFromDraft, setRestoredFromDraft] = useState(restored != null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    restored?.categoryId ?? null
  );
  const [amount, setAmount] = useState(restored?.amount ?? "");
  const [currencyDraft, setCurrencyDraft] = useState(() => ({
    mainCurrency,
    value: restored?.currency ?? mainCurrency,
  }));
  const [itemName, setItemName] = useState(restored?.itemName ?? "");
  const [editedEntryDate, setEditedEntryDate] = useState<string | null>(
    restored?.entryDate ?? null
  );
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

  const resetForm = () => {
    setSelectedCategoryId(null);
    setAmount("");
    setCurrencyDraft({ mainCurrency, value: mainCurrency });
    setItemName("");
    setEditedEntryDate(null);
    setRestoredFromDraft(false);
    if (key != null) clearDraft(key);
  };

  const selectedCategory = categories.find((category) => category.id === selectedCategoryId);

  const mutation = useLedgerMutation<
    Awaited<ReturnType<typeof createQuickEntryAction>>,
    CreateQuickEntryPayload
  >({
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: (data: CreateQuickEntryPayload) => createQuickEntryAction(data),
    successMessage: null,
    errorMessage: quickEntryFormCopy.quickEntryError,
    onSuccess: (data, variables) => {
      resetForm();
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
      ...(bookId == null ? {} : { bookId }),
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

  useEffect(() => {
    if (key == null) return;
    if (!isDirty) {
      clearDraft(key);
      return;
    }
    const draft: QuickEntryDraft = {
      categoryId: selectedCategoryId,
      amount,
      currency,
      itemName,
      entryDate: editedEntryDate,
    };
    writeDraft(key, draft);
  }, [amount, currency, editedEntryDate, isDirty, itemName, key, selectedCategoryId]);

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
    /** True while the form shows input restored from an earlier visit. */
    restoredFromDraft: restoredFromDraft && isDirty,
    discardDraft: resetForm,
  };
}
