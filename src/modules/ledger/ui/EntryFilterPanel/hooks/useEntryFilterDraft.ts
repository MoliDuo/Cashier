"use client";
import * as React from "react";
import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";
import { countActiveEntryFilters, type EntryFilters } from "@/modules/ledger/filters";
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

  const activeFilterCount = countActiveEntryFilters(filters, {
    showCategory,
    showCurrency,
    showStatus,
  });

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
