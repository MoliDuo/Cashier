"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { LedgerTab } from "@/lib/ledger-tabs";
import type { BookDto, EntryCategoryWithCount } from "@/modules/ledger/contracts";
import type { RecordScope } from "@/modules/ledger/filters";
import { readLastNewRecordBookId } from "../new-record-book-memory";
import { useWorkspaceStore } from "../store";
import { NewRecordForms } from "./NewRecordForms";
import type { CommittedView, NewRecordInputMode } from "./new-record-success-feedback";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ledgerPageCopy } from "@/copy/app";
import { bookPickerCopy, commonCopy } from "@/copy/common";

interface NewRecordDialogProps {
  /** The book being viewed, or null for 总账. */
  scope: RecordScope;
  /** The live books, for the record's book picker. */
  books: readonly BookDto[];
  activeTab: LedgerTab;
  committedView: CommittedView;
  categories: EntryCategoryWithCount[];
  mainCurrency: string;
  preferredCurrencies: string[];
  /** The ledger's zone, which dates a new record by default. */
  timeZone: string;
}

/**
 * The "new record" dialog: the AI-parse / quick-entry toggle on top, the active
 * form below, and a footer pinned to the bottom with the book on the left and
 * the submit on the right. Closing it never asks: each form keeps its unsaved
 * input as a draft and restores it on the next opening.
 */
export function NewRecordDialog({
  scope,
  books,
  activeTab,
  committedView,
  categories,
  mainCurrency,
  preferredCurrencies,
  timeZone,
}: NewRecordDialogProps) {
  // The dialog opens from every tab, so the picker labels live in the shell
  // bundle instead of the 设置 one.
  // The shell's + button opens it from outside the page, so the open flag is shared.
  const isOpen = useWorkspaceStore((state) => state.newRecordOpen);
  const setInputOpen = useWorkspaceStore((state) => state.setNewRecordOpen);
  const [inputMode, setInputMode] = useState<NewRecordInputMode>("ai");
  const [aiPending, setAiPending] = useState(false);
  const [quickPending, setQuickPending] = useState(false);
  const isSubmitting = aiPending || quickPending;
  const handleOpenChange = (open: boolean) => {
    if (!open && isSubmitting) return;
    setInputOpen(open);
  };
  // The picker opens on the book being viewed; on 总账 — no single book — it
  // opens on this device's last pick, then the first book in 设置 order. It is
  // a per-record choice: changing it does not move the view, and only a saved
  // record updates the memory.
  const [bookId, setBookId] = useState("");
  // Every opening starts the per-record pick over. A books refetch while the
  // dialog stays open must not overwrite what the user chose for this record,
  // so the pick is only reset on the closed-to-open edge.
  const [lastOpen, setLastOpen] = useState(isOpen);
  if (isOpen !== lastOpen) {
    setLastOpen(isOpen);
    if (isOpen) {
      const remembered = readLastNewRecordBookId();
      const isLive = (id: string | null): id is string =>
        id != null && books.some((book) => book.id === id);
      setBookId(isLive(scope) ? scope : isLive(remembered) ? remembered : (books[0]?.id ?? ""));
    }
  }
  // A pick whose book is no longer live (archived between the save and now,
  // say) resolves to the first book, so the picker and the submitted book
  // always agree with what the select shows.
  const selectedBook = books.find((book) => book.id === bookId) ?? books[0] ?? null;
  const selectedBookId = selectedBook?.id ?? "";

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
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
        <DialogHeader className="shrink-0 border-b px-12 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:py-4">
          <DialogTitle>{ledgerPageCopy.newRecord}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-4 sm:flex-none sm:px-6 sm:pt-6">
          <SegmentedControl
            className="mb-4 shrink-0"
            label={ledgerPageCopy.newRecordMode}
            value={inputMode}
            onChange={setInputMode}
            disabled={isSubmitting}
            options={[
              { value: "ai", label: ledgerPageCopy.aiParse },
              { value: "quick", label: ledgerPageCopy.quickEntry },
            ]}
          />
          <NewRecordForms
            bookId={selectedBookId}
            viewedBookId={scope}
            savedBook={selectedBook}
            activeTab={activeTab}
            committedView={committedView}
            inputMode={inputMode}
            categories={categories}
            mainCurrency={mainCurrency}
            preferredCurrencies={preferredCurrencies}
            setInputOpen={setInputOpen}
            setAiPending={setAiPending}
            setQuickPending={setQuickPending}
            timeZone={timeZone}
            bookPicker={
              <Select value={selectedBookId} onValueChange={setBookId} disabled={isSubmitting}>
                <SelectTrigger
                  className="w-full max-w-44"
                  aria-label={commonCopy.book}
                  title={commonCopy.book}
                >
                  <SelectValue placeholder={bookPickerCopy.namePlaceholder} />
                </SelectTrigger>
                <SelectContent position="popper" side="top">
                  {books.map((book) => (
                    <SelectItem key={book.id} value={book.id}>
                      {book.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
