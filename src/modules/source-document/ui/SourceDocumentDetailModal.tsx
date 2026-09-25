"use client";
import type { BookDto, LedgerEntry, EntryCategory } from "@/modules/ledger/contracts";
import type {
  PartialBatchCommandResult,
  SourceDocument,
  SplitSourceDocumentInput,
  SplitSourceDocumentResultDto,
  ApplyDateOrganizationInput,
  ApplyDateOrganizationResultDto,
} from "@/modules/source-document/contracts";
import { memo, useCallback, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeft, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { SourceDocumentViewDetails } from "./SourceDocumentViewDetails";
import { EditableField } from "@/components/ui/editable-field";
import { textRoleClassName } from "@/components/typography";
import type { AddEntryData } from "@/modules/source-document/hooks/useSourceDocumentDetailMutations";
import { LedgerEntriesBatchActionToolbar } from "@/modules/ledger/ui/batch-action-toolbar";
import type { PendingChanges } from "@/modules/source-document/detail-types";
import { useSourceDocumentDetailController } from "@/modules/source-document/hooks/useSourceDocumentDetailController";
import { SourceDocumentDetailFooterActions } from "./SourceDocumentDetailFooterActions";
import { SourceDocumentDetailStatusPanels } from "./SourceDocumentDetailStatusPanels";
import { SourceDocumentDetailConfirmDialogs } from "./SourceDocumentDetailConfirmDialogs";
import { SourceDocumentDetailOverlays } from "./SourceDocumentDetailOverlays";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SourceDocumentDetailModalProps {
  /** The live books, so this record's own book can be changed here. */
  books?: readonly BookDto[];
  /**
   * The record's own book, already labelled, when it is no longer among the live
   * ones. It is shown as the selected option, read-only, so a retired book names
   * itself instead of leaving the picker blank.
   */
  archivedBookLabel?: string;
  onAssignBook?: (bookId: string) => void;
  isAssigningBook?: boolean;
  sourceDocumentId?: string;
  sourceDocument: SourceDocument | null;
  isLoading?: boolean;
  loadError?: boolean;
  onReload?: () => Promise<void>;
  ledgerEntries: LedgerEntry[];
  categories: EntryCategory[];
  preferredCurrencies: string[];
  mainCurrency: string;
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  onExitComplete?: () => void;
  onSaveAll?: (
    input: { expectedVersion: number; changes: PendingChanges },
    onCommitted?: () => void
  ) => Promise<void>;
  onSplit?: (
    input: Omit<SplitSourceDocumentInput, "sourceDocumentId">
  ) => Promise<SplitSourceDocumentResultDto>;
  onBatchUpdate: (
    ids: string[],
    data: {
      categoryId?: string | null;
      currency?: string;
      entryDate?: string;
      description?: string;
    }
  ) => Promise<{ affectedCount: number } | undefined>;
  onBatchDeleteEntries: (
    ids: string[],
    onCommitted?: (result: PartialBatchCommandResult) => void
  ) => Promise<PartialBatchCommandResult>;
  onAddEntry?: (data: AddEntryData) => Promise<void>;
  onDeleteEntry?: (entryId: string, onCommitted?: () => void) => Promise<void>;
  onDelete?: (onCommitted?: () => void) => void | Promise<void>;
  onCancelProcessing?: () => Promise<void>;
  isCancelling?: boolean;
  onApplyDateOrganization?: (
    input: Omit<ApplyDateOrganizationInput, "sourceDocumentId">
  ) => Promise<ApplyDateOrganizationResultDto>;
  onDismissDateOrganization?: (suggestionId: string) => Promise<unknown>;
  isOrganizingDates?: boolean;
  timeZone?: string;
}

function SourceDocumentDetailEditor({
  books,
  archivedBookLabel,
  onAssignBook,
  isAssigningBook,
  sourceDocument,
  isLoading = false,
  loadError = false,
  onReload,
  ledgerEntries,
  categories,
  preferredCurrencies,
  mainCurrency,
  open,
  onClose,
  onBack,
  onExitComplete,
  onSaveAll,
  onSplit,
  onBatchUpdate,
  onBatchDeleteEntries,
  onAddEntry,
  onDeleteEntry,
  onDelete,
  onCancelProcessing,
  isCancelling = false,
  onApplyDateOrganization,
  onDismissDateOrganization,
  isOrganizingDates = false,
  timeZone,
}: SourceDocumentDetailModalProps) {
  const t = useTranslations("SourceDocumentDetail");
  const tCommon = useTranslations("Common");
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [dateAdjustmentActive, setDateAdjustmentActive] = useState(false);
  const [dateDraftDirty, setDateDraftDirty] = useState(false);
  // The narrow-viewport pane toggle lives here rather than in ViewDetails so
  // the footer's "view evidence" button can drive it.
  const [mobileView, setMobileView] = useState<"details" | "evidence">("details");
  const hasEvidence =
    sourceDocument != null &&
    (sourceDocument.files.length > 0 ||
      (sourceDocument.text != null && sourceDocument.text.trim() !== ""));
  const discardDateDraft = useCallback(() => {
    setDateAdjustmentActive(false);
    setDateDraftDirty(false);
  }, []);
  const { editor, selection, status, dialogs, actions } = useSourceDocumentDetailController({
    sourceDocument,
    ledgerEntries,
    open,
    isCancelling,
    externalUnsaved: dateDraftDirty,
    onDiscardExternalUnsaved: discardDateDraft,
    onClose,
    onReload,
    onSaveAll,
    onSplit,
    onBatchUpdate,
    onBatchDeleteEntries,
    onAddEntry,
    onDeleteEntry,
    onDelete,
    onCancelProcessing,
    t,
    tCommon,
  });
  const handleClose = () => {
    if (!dateDraftDirty) discardDateDraft();
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
      {...(sourceDocument?.supportedActions.includes("split_entries") && onSplit != null
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
                aria-label={tCommon("back")}
                title={tCommon("back")}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div className="flex-1 min-w-0 pr-8">
              <EditableField
                value={editor.displayTitle}
                onChange={(v) => editor.handleSourceDocChange({ title: v })}
                placeholder={t("untitled")}
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
              aria-label={tCommon("close")}
              title={tCommon("close")}
            >
              <X className="size-4" />
            </Button>
          </DialogHeader>
          {sourceDocument != null &&
          sourceDocument.bookId != null &&
          onAssignBook != null &&
          books != null &&
          books.length > 0 ? (
            <div className="flex shrink-0 items-center justify-between border-b px-4 py-2 text-sm">
              <span>{tCommon("book")}</span>
              <Select
                value={sourceDocument.bookId}
                onValueChange={onAssignBook}
                disabled={status.busy || isAssigningBook || editor.isEditMode}
              >
                <SelectTrigger className="w-40" aria-label={tCommon("book")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {books.map((book) => (
                    <SelectItem key={book.id} value={book.id}>
                      {book.name}
                    </SelectItem>
                  ))}
                  {archivedBookLabel != null ? (
                    <SelectItem value={sourceDocument.bookId}>{archivedBookLabel}</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:flex lg:flex-col lg:overflow-hidden">
            <div className="shrink-0">
              <SourceDocumentDetailStatusPanels
                sourceDocument={sourceDocument}
                loadError={loadError}
                isLoading={isLoading}
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
                  {...(onApplyDateOrganization == null ? {} : { onApplyDateOrganization })}
                  {...(onDismissDateOrganization == null ? {} : { onDismissDateOrganization })}
                  isOrganizingDates={isOrganizingDates}
                  dateOrganizationDisabled={editor.isEditMode || selection.isSelectionMode}
                  {...(timeZone != null ? { timeZone } : {})}
                  mobileView={mobileView}
                  onMobileViewChange={setMobileView}
                  onDateAdjustmentStateChange={(active, dirty) => {
                    setDateAdjustmentActive(active || dirty);
                    setDateDraftDirty(dirty);
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
            isCancelling={isCancelling}
            {...(onCancelProcessing != null
              ? { onCancelProcessing: actions.handleCancelProcessing }
              : {})}
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
          t={t}
          tCommon={tCommon}
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
          unsavedGuard={dialogs.unsavedGuard}
          handleDiscardAndClose={actions.handleDiscardAndClose}
        />
      </Dialog>
      <SourceDocumentDetailOverlays
        sourceDocument={sourceDocument}
        showRetryDialog={dialogs.showRetryDialog}
        setShowRetryDialog={dialogs.setShowRetryDialog}
        onRetryPendingChange={status.setIsRetrying}
        onRetrySuccess={() => {
          dialogs.setShowRetryDialog(false);
          onClose();
        }}
        ledgerEntries={ledgerEntries}
        selectedIds={selection.selectedIds}
        splitInitialDate={editor.splitInitialDate}
        isSplitting={status.isSplitting}
        showSplitDialog={dialogs.showSplitDialog}
        setShowSplitDialog={dialogs.setShowSplitDialog}
        handleSplit={actions.handleSplit}
        showAddEntryDialog={dialogs.showAddEntryDialog}
        onAddEntry={onAddEntry}
        categories={categories}
        preferredCurrencies={preferredCurrencies}
        mainCurrency={mainCurrency}
        isSaving={status.isSaving}
        setShowAddEntryDialog={dialogs.setShowAddEntryDialog}
        handleAddEntrySubmit={actions.handleAddEntrySubmit}
        {...(timeZone != null ? { timeZone } : {})}
      />
    </>
  );
}

export const SourceDocumentDetailModal = memo(function SourceDocumentDetailModal(
  props: SourceDocumentDetailModalProps
) {
  const editorKey = props.sourceDocumentId ?? props.sourceDocument?.id ?? "empty";
  return <SourceDocumentDetailEditor key={editorKey} {...props} />;
});
