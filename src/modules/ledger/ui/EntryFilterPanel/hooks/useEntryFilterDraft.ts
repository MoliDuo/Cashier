"use client";
import * as React from "react";
import { periodToDateRange, type PeriodParams, type PeriodPreset } from "@/lib/period-utils";
import { formatDateTimeForApi } from "@/lib/date-utils";
import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";
import { resolveActivePreset, type EntryFilterPreset } from "@/modules/ledger/entry-filter-presets";
import { type EntryFilters, type RecordScope } from "@/modules/ledger/filters";
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
  onFiltersChange: (filters: EntryFilters, requestedPeriod?: PeriodPreset) => void;
  periodParams: PeriodParams;
  showCategory: boolean;
  showCurrency: boolean;
  showStatus: boolean;
  /** Applied scope, and its setter. Both absent hides the scope section. */
  recordScope?: RecordScope | undefined;
  onRecordScopeChange?: ((scope: RecordScope) => void) | undefined;
}

/** Owns the filter dialog's draft state, independent from the applied `filters` prop. */
export function useEntryFilterDraft({
  filters,
  onFiltersChange,
  periodParams,
  showCategory,
  showCurrency,
  showStatus,
  recordScope,
  onRecordScopeChange,
}: UseEntryFilterDraftOptions) {
  const [open, setOpen] = React.useState(false);

  // Internal state for editing before applying - initialized from filters when dialog opens
  const [tempFilters, setTempFilters] = React.useState<EntryFilters>(filters);
  const [tempPeriod, setTempPeriod] = React.useState<EntryFilterPreset | null>(null);
  const [tempRecordScope, setTempRecordScope] = React.useState<RecordScope>(recordScope ?? "all");

  const showRecordScope = recordScope != null && onRecordScopeChange != null;

  // Reset temp filters when the dialog opens (not using useEffect to sync with external filters)
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      // Initialize draft state from current filters when opening
      setTempFilters(filters);
      setTempPeriod(null);
      setTempRecordScope(recordScope ?? "all");
    }
  };

  // Which date range the ledger is on, and which one the draft is on: the panel
  // paints the draft so a preset click is visible before it is applied.
  const activePreset = resolveActivePreset(periodParams);
  const displayPreset = tempPeriod ?? activePreset;

  const activeFilterCount = [
    activePreset !== "thisMonth",
    filters.search != null && filters.search.trim() !== "",
    showStatus && (filters.statuses?.length ?? 0) > 0,
    showCategory && filters.categoryId != null && filters.categoryId !== "",
    showCurrency && filters.currency != null && filters.currency !== "",
    filters.minAmount !== undefined && filters.minAmount !== null,
    filters.maxAmount !== undefined && filters.maxAmount !== null,
    showRecordScope && recordScope !== "all",
  ].filter((x): x is true => x === true).length;

  const handleDatePreset = (preset: EntryFilterPreset) => {
    let newFilters = { ...tempFilters };

    if (preset === "all") {
      delete newFilters.startDate;
      delete newFilters.endDate;
    } else if (preset !== "custom") {
      // Delegates to the same date-range math the server and the URL layer
      // use (period-utils.ts), instead of a second, drifting implementation.
      const range = periodToDateRange({ period: preset });
      newFilters = {
        ...newFilters,
        ...(range.startDate != null ? { startDate: range.startDate } : {}),
        ...(range.endDate != null ? { endDate: range.endDate } : {}),
      };
    }

    setTempFilters(newFilters);
    setTempPeriod(preset);
  };

  const setTempFilterDate = (field: "startDate" | "endDate", date: Date | null) => {
    setTempFilters((prev) => {
      const next: EntryFilters = { ...prev };
      if (field === "startDate") {
        if (date == null) {
          delete next.startDate;
        } else {
          next.startDate = formatDateTimeForApi(date);
        }
      } else if (date == null) {
        delete next.endDate;
      } else {
        next.endDate = formatDateTimeForApi(date);
      }
      return next;
    });
    setTempPeriod("custom");
  };

  const handleApply = () => {
    const normalizedFilters = normalizeAmountRange(tempFilters);
    if (tempPeriod == null) onFiltersChange(normalizedFilters);
    else onFiltersChange(normalizedFilters, tempPeriod);
    // The scope is committed with everything else: leaving the dialog is what
    // makes the draft the applied filters.
    if (showRecordScope && tempRecordScope !== recordScope) onRecordScopeChange?.(tempRecordScope);
    setOpen(false);
  };

  const handleReset = () => {
    const now = new Date();
    const defaultFilters: EntryFilters = {
      startDate: formatDateTimeForApi(new Date(now.getFullYear(), now.getMonth(), 1)),
      endDate: formatDateTimeForApi(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      categoryId: null,
      currency: null,
      minAmount: null,
      maxAmount: null,
      statuses: [],
      search: null,
    };
    setTempFilters(defaultFilters);
    setTempPeriod("thisMonth");
    setTempRecordScope("all");
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
    tempPeriod,
    activeFilterCount,
    activePreset,
    displayPreset,
    handleDatePreset,
    setTempFilterDate,
    handleApply,
    handleReset,
    toggleStatus,
    showRecordScope,
    tempRecordScope,
    setTempRecordScope,
  };
}
