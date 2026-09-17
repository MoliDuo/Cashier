"use client";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TOOLBAR_CONTROL_CLASS } from "@/components/toolbar-control";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { EntryCategory } from "@/modules/ledger/contracts";
import type { PeriodParams, PeriodPreset } from "@/lib/period-utils";
import { useEntryFilterDraft } from "./EntryFilterPanel/hooks/useEntryFilterDraft";
import { EntryFilterContent } from "./EntryFilterPanel/components/EntryFilterContent";
import { type EntryFilters, type RecordScope } from "@/modules/ledger/filters";

export type { EntryFilters, RecordScope } from "@/modules/ledger/filters";

interface EntryFilterPanelProps {
  filters: EntryFilters;
  onFiltersChange: (filters: EntryFilters, requestedPeriod?: PeriodPreset) => void;
  periodParams: PeriodParams;
  categories?: EntryCategory[];
  preferredCurrencies?: string[];
  /** Ledger timezone: the date fields' 今天/昨天 must name the ledger's day. */
  timeZone?: string;
  showCategory?: boolean;
  showCurrency?: boolean;
  showStatus?: boolean;
  /**
   * The member whose records to show. Supplying both this and its setter adds
   * the section; a tab without a member list around it simply omits them.
   */
  recordScope?: RecordScope | undefined;
  onRecordScopeChange?: ((scope: RecordScope) => void) | undefined;
  className?: string;
}

/**
 * The filter is one dialog at every width, the way every other box in the app
 * opens — never a panel anchored to the trigger and no longer a bottom sheet on
 * a phone. The draft and its 应用筛选 are what make that possible: the panel
 * covers the toolbar it was opened from, so it has to carry its own title and
 * its own apply.
 */
export function EntryFilterPanel({
  filters,
  onFiltersChange,
  periodParams,
  categories = [],
  preferredCurrencies = [],
  timeZone,
  showCategory = true,
  showCurrency = true,
  showStatus = true,
  recordScope,
  onRecordScopeChange,
  className,
}: EntryFilterPanelProps) {
  const t = useTranslations("EntryFilterPanel");

  const draft = useEntryFilterDraft({
    filters,
    onFiltersChange,
    periodParams,
    showCategory,
    showCurrency,
    showStatus,
    recordScope,
    onRecordScopeChange,
  });
  const { open, handleOpenChange, activeFilterCount } = draft;

  const trigger = (
    <Button
      variant="outline"
      className={cn(
        TOOLBAR_CONTROL_CLASS,
        activeFilterCount > 0 && "border-primary/50 text-primary"
      )}
      onClick={() => handleOpenChange(true)}
      aria-label={
        activeFilterCount > 0 ? t("activeFilterCount", { count: activeFilterCount }) : t("filter")
      }
      aria-haspopup="dialog"
      aria-expanded={open}
    >
      <SlidersHorizontal aria-hidden="true" />
      <span>{t("filter")}</span>
      {activeFilterCount > 0 && (
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-micro font-medium text-primary">
          {activeFilterCount}
        </span>
      )}
    </Button>
  );

  const filterContent = (
    <EntryFilterContent
      {...draft}
      categories={categories}
      preferredCurrencies={preferredCurrencies}
      timeZone={timeZone}
      showCategory={showCategory}
      showCurrency={showCurrency}
      showStatus={showStatus}
    />
  );

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {trigger}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          variant="modal"
          // The header and the footer are fixed rows; the sections between them
          // are the only thing that scrolls, so 应用筛选 is never scrolled away.
          className="max-h-[calc(100svh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0"
          aria-describedby={undefined}
        >
          <DialogHeader className="border-b border-border px-4 py-3 pr-12">
            <DialogTitle className="text-sm font-medium">{t("filter")}</DialogTitle>
          </DialogHeader>
          {filterContent}
        </DialogContent>
      </Dialog>
    </div>
  );
}
