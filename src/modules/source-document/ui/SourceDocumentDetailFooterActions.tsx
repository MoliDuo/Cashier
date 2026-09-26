"use client";

import { FileText, RefreshCw, Trash2, X, Save, XCircle, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { SourceDocument } from "@/modules/source-document/contracts";
import { commonCopy } from "@/copy/common";
import { sourceDocumentActionCopy, sourceDocumentDetailCopy } from "@/copy/source-document";

interface SourceDocumentDetailFooterActionsProps {
  sourceDocument: SourceDocument | null;
  isEditMode: boolean;
  isSelectionMode: boolean;
  busy: boolean;
  interactionDisabled: boolean;
  hasPendingChanges: boolean;
  pendingChangesCount: number;
  isCancelling: boolean;
  onCancelProcessing?: () => void;
  onOpenRetryDialog: () => void;
  onRequestDelete: () => void;
  onCancelEditMode: () => void;
  onEditSave: () => Promise<boolean>;
  onEnterEditMode: () => void;
  /**
   * Opens the evidence pane on narrow viewports; the modal omits it on
   * desktop, where both panes are already visible side by side.
   */
  onViewEvidence?: () => void;
}

/** Non-selection-mode footer bar for processing, edit, retry, and delete actions. */
export function SourceDocumentDetailFooterActions({
  sourceDocument,
  isEditMode,
  isSelectionMode,
  busy,
  interactionDisabled,
  hasPendingChanges,
  pendingChangesCount,
  isCancelling,
  onCancelProcessing,
  onOpenRetryDialog,
  onRequestDelete,
  onCancelEditMode,
  onEditSave,
  onEnterEditMode,
  onViewEvidence,
}: SourceDocumentDetailFooterActionsProps) {
  return (
    <div className="z-modal-footer flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-surface/80 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:bg-surface2/30 sm:py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {sourceDocument?.supportedActions.includes("cancel_processing") &&
          onCancelProcessing != null && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 px-3 text-muted-foreground"
              onClick={onCancelProcessing}
              disabled={interactionDisabled}
              aria-label={sourceDocumentActionCopy.cancelProcessing}
              // The spinner is the only sign the cancellation was taken; a
              // reader who cannot see it gets the same news from aria-busy.
              aria-busy={isCancelling || undefined}
            >
              <XCircle
                aria-hidden="true"
                className={cn("h-3.5 w-3.5", isCancelling && "animate-spin")}
              />
              <span className="hidden sm:inline">{sourceDocumentActionCopy.cancelProcessing}</span>
            </Button>
          )}

        {/* View evidence, edit & retry, delete — in that order. */}
        {onViewEvidence != null && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 px-3 text-muted-foreground lg:hidden"
            onClick={onViewEvidence}
            disabled={interactionDisabled}
            aria-label={sourceDocumentDetailCopy.viewEvidence}
          >
            <FileText aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{sourceDocumentDetailCopy.viewEvidence}</span>
          </Button>
        )}

        {sourceDocument?.supportedActions.includes("edit_retry") && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 gap-1.5 text-muted-foreground"
            onClick={onOpenRetryDialog}
            disabled={interactionDisabled}
            aria-label={sourceDocumentDetailCopy.editRetry}
          >
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{sourceDocumentDetailCopy.editRetry}</span>
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-9 px-3 gap-1.5 text-danger border-danger/40 hover:bg-danger/10 hover:text-danger"
          onClick={onRequestDelete}
          aria-label={commonCopy.delete}
          disabled={interactionDisabled}
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{commonCopy.delete}</span>
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {isSelectionMode ? null : isEditMode ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={onCancelEditMode}
              disabled={busy}
            >
              <X className="h-3.5 w-3.5 mr-1.5" />
              {sourceDocumentDetailCopy.cancelEdit}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1.5 shadow-lg shadow-primary/20"
              onClick={onEditSave}
              disabled={busy || !hasPendingChanges}
            >
              <Save className="h-3.5 w-3.5" />
              {hasPendingChanges
                ? sourceDocumentDetailCopy.saveChanges({ count: pendingChangesCount })
                : commonCopy.save}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={onEnterEditMode}
            disabled={interactionDisabled}
          >
            <Pencil className="h-3.5 w-3.5" />
            {commonCopy.edit}
          </Button>
        )}
      </div>
    </div>
  );
}
