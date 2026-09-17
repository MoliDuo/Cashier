"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { EntryCategory } from "@/modules/ledger/contracts";
import { CategoryIcon } from "@/components/CategoryIcon";
import { DateFilter } from "@/components/ui/date-filter";
import {
  ENTRY_FILTER_PRESETS,
  type EntryFilterPreset,
} from "@/modules/ledger/entry-filter-presets";
import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";
import type { EntryFilters, RecordScope } from "@/modules/ledger/filters";

const STATUS_OPTIONS: SourceDocumentProcessingStatus[] = [
  "processing",
  "completed",
  "failed",
  "cancelled",
];

const RECORD_SCOPES: RecordScope[] = ["all", "mine", "partner"];

interface EntryFilterContentProps {
  tempFilters: EntryFilters;
  setTempFilters: (updater: (prev: EntryFilters) => EntryFilters) => void;
  displayPreset: EntryFilterPreset;
  handleDatePreset: (preset: EntryFilterPreset) => void;
  setTempFilterDate: (field: "startDate" | "endDate", date: Date | null) => void;
  handleApply: () => void;
  handleReset: () => void;
  toggleStatus: (status: SourceDocumentProcessingStatus) => void;
  categories: EntryCategory[];
  preferredCurrencies: string[];
  timeZone?: string | undefined;
  showCategory: boolean;
  showCurrency: boolean;
  showStatus: boolean;
  showRecordScope: boolean;
  tempRecordScope: RecordScope;
  setTempRecordScope: (scope: RecordScope) => void;
}

export function EntryFilterContent({
  tempFilters,
  setTempFilters,
  displayPreset,
  handleDatePreset,
  setTempFilterDate,
  handleApply,
  handleReset,
  toggleStatus,
  categories,
  preferredCurrencies,
  timeZone,
  showCategory,
  showCurrency,
  showStatus,
  showRecordScope,
  tempRecordScope,
  setTempRecordScope,
}: EntryFilterContentProps) {
  const t = useTranslations("EntryFilterPanel");
  const tCommon = useTranslations("Common");
  const tDateRange = useTranslations("DateRangeFilter");
  const tSettings = useTranslations("Settings");

  const scopeLabel = (scope: RecordScope) => {
    switch (scope) {
      case "all":
        return tCommon("allMembers");
      case "mine":
        return tCommon("myRecords");
      case "partner":
        return tCommon("partnerRecords");
    }
  };

  const statusLabel = (status: SourceDocumentProcessingStatus) => {
    switch (status) {
      case "processing":
        return t("statusProcessing");
      case "completed":
        return t("statusCompleted");
      case "failed":
        return t("statusFailed");
      case "cancelled":
        return t("statusCancelled");
    }
  };
  const presetLabel = (preset: EntryFilterPreset) => {
    switch (preset) {
      case "thisMonth":
        return tDateRange("thisMonth");
      case "lastMonth":
        return tDateRange("lastMonth");
      case "all":
        return tDateRange("all");
      case "custom":
        return tDateRange("customRange");
    }
  };

  // The footer stays put while the sections scroll, so the primary action is
  // never something the user has to scroll to find.
  return (
    <div className="flex min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* Whose records: the one section that changes the set the other
            filters narrow, so it leads the panel. */}
        {showRecordScope ? (
          <div
            className="flex gap-1 rounded-lg bg-surface2 p-1"
            role="group"
            aria-label={tCommon("recordScope")}
          >
            {RECORD_SCOPES.map((scope) => {
              const isActive = tempRecordScope === scope;
              return (
                <button
                  key={scope}
                  type="button"
                  aria-pressed={isActive}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors duration-[var(--motion-feedback)]",
                    isActive
                      ? "bg-surface text-primary shadow-sm"
                      : "text-muted-foreground hover:text-text"
                  )}
                  onClick={() => setTempRecordScope(scope)}
                >
                  {scopeLabel(scope)}
                </button>
              );
            })}
          </div>
        ) : null}

        <Input
          type="search"
          name="search"
          autoComplete="off"
          value={tempFilters.search ?? ""}
          onChange={(event) =>
            setTempFilters((previous) => ({
              ...previous,
              search: event.target.value === "" ? null : event.target.value,
            }))
          }
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
        />

        <div className="space-y-2">
          <div
            className="flex gap-1 rounded-lg bg-surface2 p-1"
            role="group"
            aria-label={t("dateRange")}
          >
            {ENTRY_FILTER_PRESETS.map((preset) => {
              const isActive = displayPreset === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={isActive}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors duration-[var(--motion-feedback)]",
                    isActive
                      ? "bg-surface text-primary shadow-sm"
                      : "text-muted-foreground hover:text-text"
                  )}
                  onClick={() => handleDatePreset(preset)}
                >
                  {presetLabel(preset)}
                </button>
              );
            })}
          </div>
          {/* The two fields only say something when the range is hand-picked;
              while a preset is active they would restate the preset. */}
          {displayPreset === "custom" ? (
            <div className="flex items-center gap-2">
              <DateFilter
                {...(tempFilters.startDate != null ? { value: tempFilters.startDate } : {})}
                onChange={(date) => setTempFilterDate("startDate", date)}
                size="sm"
                className="h-9 flex-1"
                showClear={false}
                ariaLabel={tDateRange("startDate")}
                {...(timeZone != null ? { timeZone } : {})}
              />
              <span className="text-sm text-muted-foreground">-</span>
              <DateFilter
                {...(tempFilters.endDate != null ? { value: tempFilters.endDate } : {})}
                onChange={(date) => setTempFilterDate("endDate", date)}
                size="sm"
                className="h-9 flex-1"
                showClear={false}
                ariaLabel={tDateRange("endDate")}
                {...(timeZone != null ? { timeZone } : {})}
              />
            </div>
          ) : null}
        </div>

        {showCategory && (
          <Select
            value={tempFilters.categoryId ?? "__all__"}
            onValueChange={(value) =>
              setTempFilters((prev) => ({
                ...prev,
                categoryId: value === "__all__" ? null : value,
              }))
            }
          >
            <SelectTrigger aria-label={t("category")} className="w-full">
              <SelectValue placeholder={t("allCategories")} />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              <SelectItem value="__all__">{t("allCategories")}</SelectItem>
              <SelectItem value="__uncategorized__">{tSettings("uncategorized")}</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  <CategoryIcon iconName={cat.icon} className="w-4 h-4 mr-2 inline-block" />
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {showCurrency && preferredCurrencies.length > 0 && (
          <Select
            value={tempFilters.currency ?? "__all__"}
            onValueChange={(value) =>
              setTempFilters((prev) => ({
                ...prev,
                currency: value === "__all__" ? null : value,
              }))
            }
          >
            <SelectTrigger aria-label={t("currency")} className="w-full">
              <SelectValue placeholder={t("allCurrencies")} />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              <SelectItem value="__all__">{t("allCurrencies")}</SelectItem>
              {preferredCurrencies.map((curr) => (
                <SelectItem key={curr} value={curr}>
                  {curr}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex items-center gap-2">
          <AmountInput
            placeholder={t("minAmount")}
            aria-label={t("minAmount")}
            name="minAmount"
            value={tempFilters.minAmount ?? ""}
            allowNegative
            onChange={(value) =>
              setTempFilters((prev) => ({
                ...prev,
                minAmount: value !== "" ? value : null,
              }))
            }
            className="min-w-0 flex-1"
          />
          <span className="text-sm text-muted-foreground">-</span>
          <AmountInput
            placeholder={t("maxAmount")}
            aria-label={t("maxAmount")}
            name="maxAmount"
            value={tempFilters.maxAmount ?? ""}
            allowNegative
            onChange={(value) =>
              setTempFilters((prev) => ({
                ...prev,
                maxAmount: value !== "" ? value : null,
              }))
            }
            className="min-w-0 flex-1"
          />
        </div>

        {showStatus && (
          // A chosen status is outlined the way a chosen card is. Toggling a
          // chip off is how the status filter is cleared, so there is still no
          // 全部状态 control restating the empty state.
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("status")}>
            {STATUS_OPTIONS.map((status) => {
              const isSelected = tempFilters.statuses?.includes(status) ?? false;
              return (
                <button
                  key={status}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => toggleStatus(status)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition-colors duration-[var(--motion-feedback)]",
                    isSelected
                      ? "border-primary bg-primary/5 font-medium text-primary ring-1 ring-primary/20"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-text"
                  )}
                >
                  {statusLabel(status)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button variant="ghost" size="sm" className="flex-1" onClick={handleReset}>
          {t("reset")}
        </Button>
        <Button size="sm" className="flex-1" onClick={handleApply}>
          {t("apply")}
        </Button>
      </div>
    </div>
  );
}
