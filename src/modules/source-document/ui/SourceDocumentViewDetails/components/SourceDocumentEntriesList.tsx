"use client";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { EntryCategory, LedgerEntryEmbeddedViewDto } from "@/modules/ledger/contracts";
import type { EntryEditData } from "@/modules/source-document/types";
import type { EntriesPendingChanges } from "@/modules/source-document/detail-types";
import { SelectableEditableEntryCard } from "./SelectableEditableEntryCard";
import { commonCopy } from "@/copy/common";
import { sourceDocumentDetailCopy } from "@/copy/source-document";

interface SourceDocumentEntriesListProps {
  entries: LedgerEntryEmbeddedViewDto[];
  categories: EntryCategory[];
  preferredCurrencies: string[];
  mainCurrency: string;
  selectedEntryIds: string[];
  isSelectionMode: boolean;
  interactionDisabled: boolean;
  fieldsDisabled: boolean;
  isEditMode: boolean;
  onEntryChange: (entryId: string, changes: Partial<EntryEditData>) => void;
  onSelectEntry: (entryId: string, selected: boolean) => void;
  displayEntryDate: string;
  originalEntryDate: string;
  onAddEntry?: (() => void) | undefined;
  onDeleteEntry?: ((entryId: string) => void) | undefined;
  pendingChanges: EntriesPendingChanges;
  onRequestEdit?: () => void;
}
export function SourceDocumentEntriesList({
  entries,
  categories,
  preferredCurrencies,
  mainCurrency,
  selectedEntryIds,
  isSelectionMode,
  interactionDisabled,
  fieldsDisabled,
  isEditMode,
  onEntryChange,
  onSelectEntry,
  displayEntryDate,
  originalEntryDate,
  onAddEntry,
  onDeleteEntry,
  pendingChanges,
  onRequestEdit,
}: SourceDocumentEntriesListProps) {
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const hasAddEntry = !interactionDisabled && isEditMode && onAddEntry != null;

  return (
    <div className="min-w-0">
      {/* The card, its border and its background belong to the parent, which
          also renders the toolbar above this list. */}
      <div className="divide-y">
        {entries.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 md:p-12 text-center border border-dashed border-border/80 rounded-2xl bg-surface2/5">
            <p className="text-muted-foreground text-sm font-medium">
              {sourceDocumentDetailCopy.noEntries}
            </p>
          </div>
        ) : (
          entries.map((entry, index) => (
            <div
              key={entry.id}
              onClick={() => {
                if (!isSelectionMode && !interactionDisabled) {
                  setActiveEntryId(entry.id);
                  onRequestEdit?.();
                }
              }}
            >
              <SelectableEditableEntryCard
                entry={entry}
                categories={categories}
                categoryPlaceholder={sourceDocumentDetailCopy.selectCategory}
                preferredCurrencies={preferredCurrencies}
                mainCurrency={mainCurrency}
                selectionMode={isSelectionMode}
                selected={selectedEntryIds.includes(entry.id)}
                selectionLabel={commonCopy.selectItem({ item: entry.itemName })}
                onEntryChange={onEntryChange}
                onSelectEntry={onSelectEntry}
                sourceDocumentEntryDate={displayEntryDate}
                originalEntryDate={originalEntryDate}
                readOnly={fieldsDisabled || activeEntryId !== entry.id}
                isLast={!hasAddEntry && index === entries.length - 1}
                onDelete={
                  !interactionDisabled && isEditMode && onDeleteEntry != null
                    ? () => onDeleteEntry(entry.id)
                    : undefined
                }
                {...(pendingChanges[entry.id] !== undefined
                  ? { pendingChanges: pendingChanges[entry.id] }
                  : {})}
              />
            </div>
          ))
        )}
        {hasAddEntry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-1.5 border-dashed"
            onClick={onAddEntry}
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            {sourceDocumentDetailCopy.addEntryTitle}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
