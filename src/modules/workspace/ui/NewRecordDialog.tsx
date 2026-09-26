"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { LedgerTab } from "@/lib/ledger-tabs";
import type { BookDto, EntryCategoryWithCount } from "@/modules/ledger/contracts";
import type { RecordScope } from "@/modules/ledger/filters";
import type { EntryFilters } from "@/modules/ledger/ui/EntryFilterPanel";
import { readLastNewRecordBookId } from "../new-record-book-memory";
import { useWorkspaceStore } from "../store";
import { NewRecordForms } from "./NewRecordForms";
import type { NewRecordInputMode } from "./new-record-success-feedback";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface NewRecordDialogProps {
  /** The book being viewed, or null for 总账. */
  scope: RecordScope;
  /** The live books, for the record's book picker. */
  books: readonly BookDto[];
  activeTab: LedgerTab;
  committedFilters: EntryFilters;
  categories: EntryCategoryWithCount[];
  mainCurrency: string;
  preferredCurrencies: string[];
  /** The device's zone, used when the picked book has none of its own. */
  deviceTimeZone?: string | undefined;
}

/**
 * The "new record" dialog: AI-parse / quick-entry mode toggle plus the active
 * input form. Closing it never asks: each form keeps its unsaved input as a
 * draft and restores it on the next opening.
 */
export function NewRecordDialog({
  scope,
  books,
  activeTab,
  committedFilters,
  categories,
  mainCurrency,
  preferredCurrencies,
  deviceTimeZone,
}: NewRecordDialogProps) {
  const t = useTranslations("LedgerPage");
  const tCommon = useTranslations("Common");
  // The dialog opens from every tab, so the picker labels live in the shell
  // bundle instead of the 设置 one.
  const tBookPicker = useTranslations("BookPicker");
  // The shell's + button opens it from outside the page, so the open flag is shared.
  const isOpen = useWorkspaceStore((state) => state.newRecordOpen);
  const setInputOpen = useWorkspaceStore((state) => state.setNewRecordOpen);
  const [inputMode, setInputMode] = useState<NewRecordInputMode>("ai");
  const [aiPending, setAiPending] = useState(false);
  const [quickPending, setQuickPending] = useState(false);
  const [aiDirty, setAiDirty] = useState(false);
  const [quickDirty, setQuickDirty] = useState(false);
  const isSubmitting = aiPending || quickPending;
  const handleOpenChange = (open: boolean) => {
    if (!open && isSubmitting) return;
    setInputOpen(open);
  };
  // The picker opens on this device's last pick, falling back to the first
  // book in 设置 order. It is a per-record choice: changing it does not move
  // the view, and only a saved record updates the memory.
  const [bookId, setBookId] = useState("");
  // Every opening starts the per-record pick over. A books refetch while the
  // dialog stays open must not overwrite what the user chose for this record,
  // so the pick is only reset on the closed-to-open edge.
  const [lastOpen, setLastOpen] = useState(isOpen);
  if (isOpen !== lastOpen) {
    setLastOpen(isOpen);
    if (isOpen) {
      const remembered = readLastNewRecordBookId();
      setBookId(
        remembered != null && books.some((book) => book.id === remembered)
          ? remembered
          : (books[0]?.id ?? "")
      );
    }
  }
  // A pick whose book is no longer live (archived between the save and now,
  // say) resolves to the first book, so the picker and the submitted book
  // always agree with what the select shows.
  const selectedBook = books.find((book) => book.id === bookId) ?? books[0] ?? null;
  const selectedBookId = selectedBook?.id ?? "";
  // The book owns the record's date zone: the picked book's zone decides the
  // default day, and only a book without one falls back to the device.
  const recordTimeZone = selectedBook?.timeZone ?? deviceTimeZone;

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
        <DialogHeader className="shrink-0 border-b px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:py-4">
          <DialogTitle>{t("newRecord")}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-none sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <label htmlFor="record-book" className="text-sm">
              {tCommon("book")}
            </label>
            <Select value={selectedBookId} onValueChange={setBookId} disabled={isSubmitting}>
              <SelectTrigger id="record-book" className="w-40">
                <SelectValue placeholder={tBookPicker("namePlaceholder")} />
              </SelectTrigger>
              <SelectContent position="popper">
                {books.map((book) => (
                  <SelectItem key={book.id} value={book.id}>
                    {book.name}
                  </SelectItem>
                ))}
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
            <NewRecordForms
              bookId={selectedBookId}
              viewedBookId={scope}
              savedBook={selectedBook}
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
              {...(recordTimeZone != null ? { timeZone: recordTimeZone } : {})}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
