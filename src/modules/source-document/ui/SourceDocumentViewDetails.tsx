"use client";
import type { LedgerEntryEmbeddedViewDto, EntryCategory } from "@/modules/ledger/contracts";
import type { SourceDocument } from "@/modules/source-document/contracts";
import { type ReactNode, useMemo, memo } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EntryEditData } from "@/modules/source-document/types";
import { buildSourceDocumentDetailViewModel } from "./source-document-detail-view-model";
import { SourceDocumentSummaryHeader } from "./SourceDocumentViewDetails/components/SourceDocumentSummaryHeader";
import { SourceDocumentEntriesList } from "./SourceDocumentViewDetails/components/SourceDocumentEntriesList";
import { SourceDocumentRawEvidence } from "./SourceDocumentViewDetails/components/SourceDocumentRawEvidence";
import type {
  PendingChanges,
  SourceDocPendingChanges,
} from "@/modules/source-document/detail-types";
import { SourceDocumentDateOrganization } from "./SourceDocumentDateOrganization";
import type { ApplyDateOrganizationInput } from "../contracts";
import { sourceDocumentDetailCopy } from "@/copy/source-document";

interface SourceDocumentViewDetailsProps {
  sourceDocument: SourceDocument;
  // These entries are always the embedded, sourceDocument-less view (see
  // listLedgerEntryViewsBySourceDocumentIds); typing this as the wider
  // LedgerEntry would let `.sourceDocument` type-check while silently
  // reading undefined at runtime.
  ledgerEntries: LedgerEntryEmbeddedViewDto[];
  categories: EntryCategory[];
  preferredCurrencies?: string[];
  mainCurrency?: string;
  pendingChanges: PendingChanges;
  selectedEntryIds: string[];
  isSelectionMode: boolean;
  onSourceDocChange: (changes: SourceDocPendingChanges) => void;
  onEntryChange: (entryId: string, changes: Partial<EntryEditData>) => void;
  onSelectEntry: (entryId: string, selected: boolean) => void;
  onToggleSelectionMode: () => void;
  interactionDisabled?: boolean;
  /** When true the entry/date fields are editable. */
  isEditMode?: boolean;
  /** Opens the add-entry dialog; the "add entry" button only shows in edit mode. */
  onAddEntry?: () => void;
  /** Deletes a single entry; the per-entry delete button only shows in edit mode. */
  onDeleteEntry?: (entryId: string) => void;
  onRequestEdit?: () => void;
  onApplyDateOrganization?: (
    input: Omit<ApplyDateOrganizationInput, "sourceDocumentId">
  ) => Promise<unknown>;
  onDismissDateOrganization?: (suggestionId: string) => Promise<unknown>;
  isOrganizingDates?: boolean;
  dateOrganizationDisabled?: boolean;
  onDateAdjustmentStateChange?: (active: boolean, dirty: boolean) => void;
  /**
   * Which pane the narrow-viewport layout shows. The footer owns the toggle
   * because the "view evidence" button sits in the action bar; desktop always
   * shows both panes.
   */
  mobileView: "details" | "evidence";
  onMobileViewChange: (view: "details" | "evidence") => void;
  /** Ledger timezone; the suggestion panel names today/yesterday against it. */
  timeZone?: string;
  /**
   * The selection band, built by the modal that owns the batch write. It takes
   * the entries card's header row for as long as selection mode is on.
   */
  selectionToolbar?: ReactNode;
}

export const SourceDocumentViewDetails = memo(function SourceDocumentViewDetails({
  sourceDocument,
  ledgerEntries,
  categories,
  preferredCurrencies = [],
  mainCurrency = "CNY",
  pendingChanges,
  selectedEntryIds,
  isSelectionMode,
  onSourceDocChange,
  onEntryChange,
  onSelectEntry,
  onToggleSelectionMode,
  interactionDisabled = false,
  isEditMode = false,
  onAddEntry,
  onDeleteEntry,
  onRequestEdit,
  onApplyDateOrganization,
  onDismissDateOrganization,
  isOrganizingDates = false,
  dateOrganizationDisabled = false,
  onDateAdjustmentStateChange,
  mobileView,
  onMobileViewChange,
  timeZone,
  selectionToolbar,
}: SourceDocumentViewDetailsProps): ReactNode {
  const displayEntryDate =
    pendingChanges.sourceDoc.documentDate ?? sourceDocument.documentDate ?? "";
  // Entry/date fields are editable only while in edit mode (and never during a mutation).
  const fieldsDisabled = interactionDisabled || !isEditMode;

  const { totalInMainCurrency, unconvertedCount, staleConversionCount } = useMemo(
    () =>
      buildSourceDocumentDetailViewModel({
        ledgerEntries,
        pendingChanges,
        mainCurrency,
        entryDate: displayEntryDate,
        originalEntryDate: sourceDocument.documentDate ?? "",
      }),
    [displayEntryDate, ledgerEntries, mainCurrency, pendingChanges, sourceDocument.documentDate]
  );

  const isInvalid =
    sourceDocument.processingStatus === "failed" && sourceDocument.failureKind === "invalid_input";
  const hasEvidence =
    sourceDocument.files.length > 0 ||
    (sourceDocument.text != null && sourceDocument.text.trim().length > 0);

  return (
    <div className="grid min-h-0 gap-4 lg:h-full lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
      <div
        data-testid="source-document-details-pane"
        className={cn(
          "min-w-0 space-y-4 overflow-y-auto lg:min-h-0 lg:pr-1",
          hasEvidence && mobileView === "evidence" && "hidden lg:block"
        )}
      >
        {/* The suggestion leads: it is about to change the dates the bar below
            shows, so it sits above them. */}
        {sourceDocument.dateOrganizationSuggestion != null &&
        onApplyDateOrganization != null &&
        onDismissDateOrganization != null ? (
          <SourceDocumentDateOrganization
            key={sourceDocument.dateOrganizationSuggestion.id}
            suggestion={sourceDocument.dateOrganizationSuggestion}
            entries={ledgerEntries}
            mainCurrency={mainCurrency}
            disabled={interactionDisabled || isOrganizingDates || dateOrganizationDisabled}
            onApply={onApplyDateOrganization}
            onDismiss={onDismissDateOrganization}
            {...(timeZone != null ? { timeZone } : {})}
            {...(onDateAdjustmentStateChange == null
              ? {}
              : { onAdjustmentStateChange: onDateAdjustmentStateChange })}
          />
        ) : null}

        {/* The toolbar and the entries are one card, the way the suggestion
            panel above them reads: a header row over the list it summarises.
            Deliberately not clipped: a selected entry row is outlined one pixel
            outside itself, which is exactly the border the card draws there, so
            clipping would leave the outline with only its top and bottom. */}
        <div className="min-w-0 rounded-lg border border-border bg-surface">
          <SourceDocumentSummaryHeader
            displayEntryDate={displayEntryDate}
            totalInMainCurrency={totalInMainCurrency}
            mainCurrency={mainCurrency}
            staleConversionCount={staleConversionCount}
            unconvertedCount={unconvertedCount}
            onSourceDocChange={onSourceDocChange}
            fieldsDisabled={fieldsDisabled}
            isInvalid={isInvalid}
            entryCount={ledgerEntries.length}
            isSelectionMode={isSelectionMode}
            interactionDisabled={interactionDisabled}
            onToggleSelectionMode={onToggleSelectionMode}
            {...(selectionToolbar != null ? { selectionToolbar } : {})}
          />

          <SourceDocumentEntriesList
            entries={ledgerEntries}
            categories={categories}
            preferredCurrencies={preferredCurrencies}
            mainCurrency={mainCurrency}
            selectedEntryIds={selectedEntryIds}
            isSelectionMode={isSelectionMode}
            interactionDisabled={interactionDisabled}
            fieldsDisabled={fieldsDisabled}
            isEditMode={isEditMode}
            onEntryChange={onEntryChange}
            onSelectEntry={onSelectEntry}
            displayEntryDate={displayEntryDate}
            originalEntryDate={sourceDocument.documentDate ?? ""}
            onAddEntry={onAddEntry}
            onDeleteEntry={onDeleteEntry}
            pendingChanges={pendingChanges.entries}
            {...(onRequestEdit == null ? {} : { onRequestEdit })}
          />
        </div>
      </div>
      <aside
        className={cn(
          "min-w-0 overflow-y-auto border-t pt-4 lg:min-h-0 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0",
          hasEvidence && mobileView === "details" && "hidden lg:block"
        )}
      >
        {hasEvidence ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mb-3 lg:hidden"
            onClick={() => onMobileViewChange("details")}
          >
            <ArrowLeft className="size-4" />
            {sourceDocumentDetailCopy.backToDetails}
          </Button>
        ) : null}
        <SourceDocumentRawEvidence sourceDocument={sourceDocument} />
      </aside>
    </div>
  );
});
