"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { DeferredFeatureMessages } from "@/i18n/DeferredFeatureMessages";
import type { LedgerTab } from "@/lib/ledger-tabs";
import type { EntryCategoryWithCount } from "@/modules/ledger/contracts";
import type { EntryFilters } from "@/modules/ledger/ui/EntryFilterPanel";
import { NewRecordForms, InputFormLoadingFallback } from "./NewRecordForms";
import type { NewRecordInputMode } from "./new-record-success-feedback";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface NewRecordDialogProps {
  userId: string;
  partnerUserId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isSubmitting: boolean;
  locale: string;
  ledgerId: string;
  activeTab: LedgerTab;
  committedFilters: EntryFilters;
  inputMode: NewRecordInputMode;
  setInputMode: (mode: NewRecordInputMode) => void;
  categories: EntryCategoryWithCount[];
  mainCurrency: string;
  preferredCurrencies: string[];
  aiDirty: boolean;
  quickDirty: boolean;
  setInputOpen: (open: boolean) => void;
  setAiPending: (pending: boolean) => void;
  setQuickPending: (pending: boolean) => void;
  setAiDirty: (dirty: boolean) => void;
  setQuickDirty: (dirty: boolean) => void;
  effectiveTimeZone?: string | undefined;
}

/** The "new record" dialog: AI-parse / quick-entry mode toggle plus the active input form. */
export function NewRecordDialog({
  userId,
  partnerUserId,
  isOpen,
  onOpenChange,
  isSubmitting,
  locale,
  ledgerId,
  activeTab,
  committedFilters,
  inputMode,
  setInputMode,
  categories,
  mainCurrency,
  preferredCurrencies,
  aiDirty,
  quickDirty,
  setInputOpen,
  setAiPending,
  setQuickPending,
  setAiDirty,
  setQuickDirty,
  effectiveTimeZone,
}: NewRecordDialogProps) {
  const t = useTranslations("LedgerPage");
  const tCommon = useTranslations("Common");
  const [attributedUserId, setAttributedUserId] = useState(userId);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        variant="detail"
        className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100vw-2rem)] sm:max-w-md sm:rounded-lg"
        aria-describedby={undefined}
        hideCloseButton={isSubmitting}
        onEscapeKeyDown={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 border-b px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:py-4">
          <DialogTitle>{t("newRecord")}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-none sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <label htmlFor="record-owner" className="text-sm">
              {tCommon("recordOwner")}
            </label>
            <Select
              value={attributedUserId}
              onValueChange={setAttributedUserId}
              disabled={isSubmitting}
            >
              <SelectTrigger id="record-owner" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={userId}>{tCommon("myRecords")}</SelectItem>
                <SelectItem value={partnerUserId}>{tCommon("partnerRecords")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-1 rounded-md border border-border bg-surface2 p-1">
            <button
              type="button"
              aria-pressed={inputMode === "ai"}
              onClick={() => setInputMode("ai")}
              disabled={isSubmitting}
              className={cn(
                "flex-1 rounded-md py-1.5 text-sm font-medium transition-colors",
                inputMode === "ai"
                  ? "bg-surface text-text shadow-sm"
                  : "text-muted-foreground hover:text-text"
              )}
            >
              {t("aiParse")}
            </button>
            <button
              type="button"
              aria-pressed={inputMode === "quick"}
              onClick={() => setInputMode("quick")}
              disabled={isSubmitting}
              className={cn(
                "flex-1 rounded-md py-1.5 text-sm font-medium transition-colors",
                inputMode === "quick"
                  ? "bg-surface text-text shadow-sm"
                  : "text-muted-foreground hover:text-text"
              )}
            >
              {t("quickEntry")}
            </button>
          </div>

          <div>
            <DeferredFeatureMessages
              feature="stream"
              locale={locale}
              fallback={<InputFormLoadingFallback />}
            >
              <NewRecordForms
                attributedUserId={attributedUserId}
                ledgerId={ledgerId}
                activeTab={activeTab}
                committedFilters={committedFilters}
                inputMode={inputMode}
                categories={categories}
                mainCurrency={mainCurrency}
                preferredCurrencies={preferredCurrencies}
                aiDirty={aiDirty}
                quickDirty={quickDirty}
                setInputMode={setInputMode}
                setInputOpen={setInputOpen}
                setAiPending={setAiPending}
                setQuickPending={setQuickPending}
                setAiDirty={setAiDirty}
                setQuickDirty={setQuickDirty}
                {...(effectiveTimeZone != null ? { timeZone: effectiveTimeZone } : {})}
              />
            </DeferredFeatureMessages>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
