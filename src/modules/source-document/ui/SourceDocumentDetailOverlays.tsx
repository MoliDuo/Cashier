"use client";
import type { LedgerEntry, EntryCategory } from "@/modules/ledger/contracts";
import type { SourceDocument } from "@/modules/source-document/contracts";
import { SourceDocumentEditRetryDialog } from "./SourceDocumentEditRetryDialog";
import { SourceDocumentSplitDialog } from "./SourceDocumentSplitDialog";
import { AddLedgerEntryDialog } from "./AddLedgerEntryDialog";
import type { AddEntryData } from "@/modules/source-document/hooks/useSourceDocumentDetailMutations";

interface SourceDocumentDetailOverlaysProps {
  sourceDocument: SourceDocument | null;
  showRetryDialog: boolean;
  setShowRetryDialog: (open: boolean) => void;
  onRetryPendingChange: (pending: boolean) => void;
  onRetrySuccess: () => void;
  ledgerEntries: LedgerEntry[];
  selectedIds: string[];
  splitInitialDate: string;
  isSplitting: boolean;
  showSplitDialog: boolean;
  setShowSplitDialog: (open: boolean) => void;
  handleSplit: (entryDate: string) => Promise<void>;
  showAddEntryDialog: boolean;
  onAddEntry?: ((data: AddEntryData) => Promise<unknown>) | undefined;
  categories: EntryCategory[];
  preferredCurrencies: string[];
  mainCurrency: string;
  isSaving: boolean;
  setShowAddEntryDialog: (open: boolean) => void;
  handleAddEntrySubmit: (data: AddEntryData) => Promise<boolean>;
  /** Ledger timezone, so the split dialog names today/yesterday the ledger's way. */
  timeZone?: string;
}

/** The retry, split, and add-entry dialogs that overlay the detail modal on demand. */
export function SourceDocumentDetailOverlays({
  sourceDocument,
  showRetryDialog,
  setShowRetryDialog,
  onRetryPendingChange,
  onRetrySuccess,
  ledgerEntries,
  selectedIds,
  splitInitialDate,
  isSplitting,
  showSplitDialog,
  setShowSplitDialog,
  handleSplit,
  showAddEntryDialog,
  onAddEntry,
  categories,
  preferredCurrencies,
  mainCurrency,
  isSaving,
  setShowAddEntryDialog,
  handleAddEntrySubmit,
  timeZone,
}: SourceDocumentDetailOverlaysProps) {
  return (
    <>
      {sourceDocument && (
        <SourceDocumentEditRetryDialog
          sourceDocument={sourceDocument}
          open={showRetryDialog}
          onOpenChange={setShowRetryDialog}
          onPendingChange={onRetryPendingChange}
          onSuccess={onRetrySuccess}
        />
      )}
      {showSplitDialog ? (
        <SourceDocumentSplitDialog
          open
          selectedEntries={ledgerEntries.filter((entry) => selectedIds.includes(entry.id))}
          initialDate={splitInitialDate}
          isSubmitting={isSplitting}
          onOpenChange={setShowSplitDialog}
          onSubmit={handleSplit}
          {...(timeZone != null ? { timeZone } : {})}
        />
      ) : null}
      {showAddEntryDialog && onAddEntry != null ? (
        <AddLedgerEntryDialog
          open
          categories={categories}
          preferredCurrencies={preferredCurrencies}
          mainCurrency={mainCurrency}
          isSubmitting={isSaving}
          onOpenChange={setShowAddEntryDialog}
          onSubmit={handleAddEntrySubmit}
        />
      ) : null}
    </>
  );
}
