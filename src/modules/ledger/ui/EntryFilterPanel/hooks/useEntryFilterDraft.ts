"use client";
import * as React from "react";
import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";
import type { EntryFilters } from "@/modules/ledger/filters";
import { compare, DECIMAL_STRING_PATTERN } from "@/lib/money/decimal";

function normalizeAmountRange(filters: EntryFilters): EntryFilters {
  const { minAmount, maxAmount } = filters;

  if (
    minAmount == null ||
    maxAmount == null ||
    !DECIMAL_STRING_PATTERN.test(minAmount) ||
    !DECIMAL_STRING_PATTERN.test(maxAmount) ||
    compare(minAmount, maxAmount) <= 0
  ) {
    return filters;
  }

  return {
    ...filters,
    minAmount: maxAmount,
    maxAmount: minAmount,
  };
}

interface UseEntryFilterDraftOptions {
  filters: EntryFilters;
  onFiltersChange: (filters: EntryFilters) => void;
  showCategory: boolean;
  showCurrency: boolean;
  showStatus: boolean;
}

/** Owns the filter dialog's draft state, independent from the applied `filters` prop. */
export function useEntryFilterDraft({
  filters,
  onFiltersChange,
  showCategory,
  showCurrency,
  showStatus,
}: UseEntryFilterDraftOptions) {
  const [open, setOpen] = React.useState(false);

  // Internal state for editing before applying - initialized from filters when dialog opens
  const [tempFilters, setTempFilters] = React.useState<EntryFilters>(filters);

  // Reset temp filters when the dialog opens (not using useEffect to sync with external filters)
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      // Initialize draft state from current filters when opening
      setTempFilters(filters);
    }
  };

  // The period has a bar of its own beside the filter, so only what narrows
  // the list is counted here.
  const activeFilterCount = [
    filters.search != null && filters.search.trim() !== "",
    showStatus && (filters.statuses?.length ?? 0) > 0,
    showCategory && filters.categoryId != null && filters.categoryId !== "",
    showCurrency && filters.currency != null && filters.currency !== "",
    filters.minAmount !== undefined && filters.minAmount !== null,
    filters.maxAmount !== undefined && filters.maxAmount !== null,
  ].filter((x): x is true => x === true).length;

  const handleApply = () => {
    const normalizedFilters = normalizeAmountRange(tempFilters);
    onFiltersChange(normalizedFilters);
    setOpen(false);
  };

  const handleReset = () => {
    setTempFilters({
      categoryId: null,
      currency: null,
      minAmount: null,
      maxAmount: null,
      statuses: [],
      search: null,
    });
  };

  const toggleStatus = (status: SourceDocumentProcessingStatus) => {
    setTempFilters((prev) => {
      const current = prev.statuses ?? [];
      const exists = current.includes(status);
      return {
        ...prev,
        statuses: exists ? current.filter((s) => s !== status) : [...current, status],
      };
    });
  };

  return {
    open,
    setOpen,
    handleOpenChange,
    tempFilters,
    setTempFilters,
    activeFilterCount,
    handleApply,
    handleReset,
    toggleStatus,
  };
}
