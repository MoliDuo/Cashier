"use client";
import type { BookDto, EntryCategory } from "@/modules/ledger/contracts";
import { memo, useCallback, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DraftNotice } from "@/components/ui/draft-notice";
import { ArrowLeft, X } from "lucide-react";
import { SourceDocumentViewDetails } from "./SourceDocumentViewDetails";
import { EditableField } from "@/components/ui/editable-field";
import { textRoleClassName } from "@/components/typography";
import { LedgerEntriesBatchActionToolbar } from "@/modules/ledger/ui/batch-action-toolbar";
import { useSourceDocumentDetail } from "@/modules/source-document/hooks/useSourceDocumentDetail";
import { SourceDocumentDetailFooterActions } from "./SourceDocumentDetailFooterActions";
import { SourceDocumentDetailStatusPanels } from "./SourceDocumentDetailStatusPanels";
import { SourceDocumentDetailConfirmDialogs } from "./SourceDocumentDetailConfirmDialogs";
import { SourceDocumentEditRetryDialog } from "./SourceDocumentEditRetryDialog";
import { SourceDocumentSplitDialog } from "./SourceDocumentSplitDialog";
import { AddLedgerEntryDialog } from "./AddLedgerEntryDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { commonCopy } from "@/copy/common";
import { sourceDocumentDetailCopy } from "@/copy/source-document";

interface SourceDocumentDetailModalProps {
  /** The live books, so this record's own book can be changed here. */
  books: readonly BookDto[];
  id: string;
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  onExitComplete?: () => void;
  categories: EntryCategory[];
  mainCurrency: string;
  preferredCurrencies: string[];
  /** Ledger timezone, so dates are named the ledger's way. */
  timeZone?: string;
}

function SourceDocumentDetailEditor({
  books,
  id,
  open,
  onClose,
  onBack,
  onExitComplete,
  categories,
  mainCurrency,
  preferredCurrencies,
  timeZone,
}: SourceDocumentDetailModalProps) {
  const detail = useSourceDocumentDetail({ id, open, books, onClose });
  const { sourceDocument, ledgerEntries, editor, selection, status, dialogs, actions } = detail;
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [dateAdjustmentActive, setDateAdjustmentActive] = useState(false);
  // The narrow-viewport pane toggle lives here rather than in ViewDetails so
  // the footer's "view evidence" button can drive it.
  const [mobileView, setMobileView] = useState<"details" | "evidence">("details");
  const hasEvidence =
    sourceDocument != null &&
    (sourceDocument.files.length > 0 ||
      (sourceDocument.text != null && sourceDocument.text.trim() !== ""));
  const discardDateDraft = useCallback(() => {
    setDateAdjustmentActive(false);
  }, []);
  const handleClose = () => {
    discardDateDraft();
    actions.handleClose();
  };
  // Selection takes over the entries card's header row instead of adding a bar
  // along the bottom, so the modal reads like the stream and details toolbars:
  // the back control, the count and the batch actions on one line, and the date
  // and total step aside with the browsing state they belong to.
  const selectionToolbar = selection.isSelectionMode ? (
    <LedgerEntriesBatchActionToolbar
      selectedCount={selection.selectedIds.length}
      isAllSelected={selection.isAllSelected}
      onSelectAll={() => selection.handleSelectAll(true)}
      onClearSelection={() => selection.handleSelectAll(false)}
      onChangeCategory={actions.handleBatchCategory}
      onChangeCurrency={actions.handleBatchCurrency}
      {...(sourceDocument?.supportedActions.includes("split_entries") === true
        ? { onSplit: actions.handleOpenSplit }
        : {})}
      onDelete={actions.handleOpenBatchDelete}
      categories={categories}
      preferredCurrencies={preferredCurrencies}
      isChangingCategory={status.isSaving}
      isChangingCurrency={status.isSaving}
      isProcessing={status.busy}
    />
  ) : undefined;

  return (
    <>
      <Dialog open={open} onOpenChange={(val) => !val && !status.busy && handleClose()}>
        <DialogContent
          variant="detail"
          {...(onExitComplete !== undefined ? { onExitComplete } : {})}
          className="flex flex-col gap-0 overflow-hidden p-0 lg:h-[90dvh] lg:max-w-[1200px]"
          onOpenAutoFocus={() => {
            restoreFocusRef.current = document.activeElement as HTMLElement | null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocusRef.current?.focus();
          }}
          aria-describedby={undefined}
          hideCloseButton
          onEscapeKeyDown={(event) => status.busy && event.preventDefault()}
          onPointerDownOutside={(event) => status.busy && event.preventDefault()}
        >
          <DialogHeader className="shrink-0 flex-row items-center gap-3 space-y-0 border-b px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5 sm:py-3">
            <DialogTitle className="sr-only">{editor.displayTitle}</DialogTitle>
            {onBack != null && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() =>
                  actions.handleRequestLeave(() => {
                    discardDateDraft();
                    onBack();
                  })
                }
                disabled={status.busy}
                aria-label={commonCopy.back}
                title={commonCopy.back}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div className="flex-1 min-w-0 pr-8">
              <EditableField
                value={editor.displayTitle}
                onChange={(v) => editor.handleSourceDocChange({ title: v })}
                placeholder={sourceDocumentDetailCopy.untitled}
                displayClassName={textRoleClassName("sectionTitle", "truncate")}
                inputClassName={textRoleClassName("sectionTitle")}
                disabled={status.busy || !editor.isEditMode}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleClose}
              disabled={status.busy}
              aria-label={commonCopy.close}
              title={commonCopy.close}
            >
              <X className="size-4" />
            </Button>
          </DialogHeader>
          {sourceDocument != null && sourceDocument.bookId != null && books.length > 0 ? (
            <div className="flex shrink-0 items-center justify-between border-b px-4 py-2 text-sm">
              <span>{commonCopy.book}</span>
              <Select
                value={sourceDocument.bookId}
                onValueChange={detail.assignBook}
                disabled={status.busy || detail.isAssigningBook || editor.isEditMode}
              >
                <SelectTrigger className="w-40" aria-label={commonCopy.book}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {books.map((book) => (
                    <SelectItem key={book.id} value={book.id}>
                      {book.name}
                    </SelectItem>
                  ))}
                  {detail.archivedBookLabel != null ? (
                    <SelectItem value={sourceDocument.bookId}>
                      {detail.archivedBookLabel}
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:flex lg:flex-col lg:overflow-hidden">
            <div className="shrink-0">
              {status.restoredDraft != null ? (
                <div className="mb-3">
                  <DraftNotice
                    outdated={status.restoredDraft.outdated}
                    disabled={status.busy}
                    onDiscard={actions.handleDiscardDraft}
                  />
                </div>
              ) : null}
              <SourceDocumentDetailStatusPanels
                sourceDocument={sourceDocument}
                loadError={detail.loadError}
                isLoading={detail.isLoading}
                isReloading={status.isReloading}
                reloadError={status.reloadError}
                onClose={onClose}
                onReload={() => void actions.handleReload()}
              />
            </div>

            {sourceDocument && (
              <div className="min-h-0 lg:flex-1">
                <SourceDocumentViewDetails
                  sourceDocument={sourceDocument}
                  ledgerEntries={ledgerEntries}
                  categories={categories}
                  preferredCurrencies={preferredCurrencies}
                  mainCurrency={mainCurrency}
                  pendingChanges={editor.pendingChanges}
                  selectedEntryIds={selection.selectedIds}
                  isSelectionMode={selection.isSelectionMode}
                  onSourceDocChange={editor.handleSourceDocChange}
                  onEntryChange={editor.handleEntryChange}
                  onSelectEntry={selection.handleSelect}
                  onToggleSelectionMode={() =>
                    !dateAdjustmentActive && actions.handleToggleSelectionMode()
                  }
                  interactionDisabled={status.busy}
                  isEditMode={editor.isEditMode}
                  onAddEntry={actions.handleOpenAddEntry}
                  onDeleteEntry={actions.handleRequestDeleteEntry}
                  onRequestEdit={() => !dateAdjustmentActive && actions.handleEnterEditMode()}
                  onApplyDateOrganization={detail.applyDateOrganization}
                  onDismissDateOrganization={detail.dismissDateOrganization}
                  isOrganizingDates={detail.isOrganizingDates}
                  dateOrganizationDisabled={editor.isEditMode || selection.isSelectionMode}
                  {...(timeZone != null ? { timeZone } : {})}
                  mobileView={mobileView}
                  onMobileViewChange={setMobileView}
                  onDateAdjustmentStateChange={(active, dirty) => {
                    setDateAdjustmentActive(active || dirty);
                  }}
                  {...(selectionToolbar != null ? { selectionToolbar } : {})}
                />
              </div>
            )}
          </div>

          <SourceDocumentDetailFooterActions
            sourceDocument={sourceDocument}
            isEditMode={editor.isEditMode}
            isSelectionMode={selection.isSelectionMode}
            busy={status.busy}
            interactionDisabled={status.interactionDisabled}
            hasPendingChanges={editor.hasPendingChanges}
            pendingChangesCount={editor.pendingChangesCount}
            isCancelling={detail.isCancelling}
            onCancelProcessing={actions.handleCancelProcessing}
            onOpenRetryDialog={actions.handleOpenRetry}
            onRequestDelete={actions.handleRequestDelete}
            onCancelEditMode={actions.handleCancelEditMode}
            onEditSave={actions.handleEditSave}
            onEnterEditMode={actions.handleEnterEditMode}
            {...(hasEvidence && mobileView === "details"
              ? { onViewEvidence: () => setMobileView("evidence") }
              : {})}
          />
        </DialogContent>

        <SourceDocumentDetailConfirmDialogs
          showBatchModePendingConfirm={dialogs.showBatchModePendingConfirm}
          setShowBatchModePendingConfirm={dialogs.setShowBatchModePendingConfirm}
          handleSaveAndEnterBatchMode={actions.handleSaveAndEnterBatchMode}
          handleDiscardAndEnterBatchMode={actions.handleDiscardAndEnterBatchMode}
          showBatchDeleteConfirm={dialogs.showBatchDeleteConfirm}
          setShowBatchDeleteConfirm={dialogs.setShowBatchDeleteConfirm}
          selectedCount={selection.selectedIds.length}
          handleBatchDelete={actions.handleBatchDelete}
          pendingDeleteEntryId={dialogs.pendingDeleteEntryId}
          setPendingDeleteEntryId={dialogs.setPendingDeleteEntryId}
          handleDeleteEntry={actions.handleDeleteEntry}
          showDeleteConfirm={dialogs.showDeleteConfirm}
          setShowDeleteConfirm={dialogs.setShowDeleteConfirm}
          handleDeleteDocument={actions.handleDeleteDocument}
          saveAndContinueGate={dialogs.saveAndContinueGate}
          discardEditsGate={dialogs.discardEditsGate}
          handleConfirmDiscardEdits={actions.handleConfirmDiscardEdits}
        />
      </Dialog>
      {sourceDocument != null ? (
        <SourceDocumentEditRetryDialog
          sourceDocument={sourceDocument}
          open={dialogs.showRetryDialog}
          onOpenChange={dialogs.setShowRetryDialog}
          onPendingChange={status.setIsRetrying}
          onSuccess={() => {
            dialogs.setShowRetryDialog(false);
            onClose();
          }}
        />
      ) : null}
      {dialogs.showSplitDialog ? (
        <SourceDocumentSplitDialog
          open
          selectedEntries={ledgerEntries.filter((entry) =>
            selection.selectedIds.includes(entry.id)
          )}
          initialDate={editor.splitInitialDate}
          isSubmitting={status.isSplitting}
          onOpenChange={dialogs.setShowSplitDialog}
          onSubmit={actions.handleSplit}
          {...(timeZone != null ? { timeZone } : {})}
        />
      ) : null}
      {dialogs.showAddEntryDialog ? (
        <AddLedgerEntryDialog
          open
          categories={categories}
          preferredCurrencies={preferredCurrencies}
          mainCurrency={mainCurrency}
          isSubmitting={status.isSaving}
          onOpenChange={dialogs.setShowAddEntryDialog}
          onSubmit={actions.handleAddEntrySubmit}
        />
      ) : null}
    </>
  );
}

export const SourceDocumentDetailModal = memo(function SourceDocumentDetailModal(
  props: SourceDocumentDetailModalProps
) {
  return <SourceDocumentDetailEditor key={props.id} {...props} />;
});
