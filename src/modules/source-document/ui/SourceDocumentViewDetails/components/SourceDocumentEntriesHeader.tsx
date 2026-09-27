"use client";
import type { ReactNode } from "react";
import { ArrowLeft, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { textRoleClassName } from "@/components/typography";
import { sourceDocumentDetailCopy } from "@/copy/source-document";

interface SourceDocumentEntriesHeaderProps {
  entryCount: number;
  isSelectionMode: boolean;
  /** Whether selecting is on offer at all: the record is editable and has entries. */
  canSelect: boolean;
  onToggleSelectionMode: () => void;
  /** The selection band, which takes the row while selection mode is on. */
  selectionToolbar?: ReactNode;
}

/**
 * The entries card's header row: its name and count, and the switch into
 * selection, which then gives the row to the batch actions.
 */
export function SourceDocumentEntriesHeader({
  entryCount,
  isSelectionMode,
  canSelect,
  onToggleSelectionMode,
  selectionToolbar,
}: SourceDocumentEntriesHeaderProps) {
  const toggleLabel = isSelectionMode
    ? sourceDocumentDetailCopy.cancelSelect
    : sourceDocumentDetailCopy.select;
  return (
    <div
      data-testid="source-document-entries-header"
      className="flex min-h-12 min-w-0 items-center gap-2 border-b border-border py-2 pl-2 pr-3"
    >
      {canSelect ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSelectionMode}
          className="size-8 shrink-0 self-start"
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          {isSelectionMode ? (
            <ArrowLeft aria-hidden="true" className="size-4" />
          ) : (
            <ListChecks aria-hidden="true" className="size-4" />
          )}
        </Button>
      ) : null}
      {selectionToolbar != null ? (
        <div className="min-w-0 flex-1">{selectionToolbar}</div>
      ) : (
        <h3 className={textRoleClassName("bodyStrong", "min-w-0 flex-1 pl-1")}>
          {sourceDocumentDetailCopy.entriesTab}
          <span className="ml-1.5 font-normal text-muted-foreground">{entryCount}</span>
        </h3>
      )}
    </div>
  );
}
