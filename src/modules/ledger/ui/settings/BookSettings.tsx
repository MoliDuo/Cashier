"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowUp,
  Archive,
  ArchiveRestore,
  Check,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBookMutations } from "@/modules/ledger/hooks/useBookMutations";
import { useBooks } from "@/modules/ledger/hooks/useBooks";
import { SettingsField } from "./SettingsField";
import { SettingsSection } from "./SettingsSection";
import type { BookDto } from "@/modules/ledger/contracts";

/**
 * The zones the picker offers — a short list rather than every IANA name, and
 * 自动 covers "wherever this device is". A book's zone dates the uploads that
 * arrive through its own API keys.
 */
const TIME_ZONES = [
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
] as const;

interface BookSettingsProps {
  ledgerId: string;
  /**
   * A list that already contains the archived rows. Leaving it undefined means
   * 设置 was opened without one — the workspace switcher only carries the live
   * books — and the complete list is fetched rather than seeded with a partial
   * one, which the archived-inclusive query would then trust for ten minutes.
   */
  initialBooks?: readonly BookDto[] | undefined;
}

/**
 * 分账: reorder, add, rename, archive, restore, delete and set a zone. The
 * order here is the order of the pull-down switcher, and the archived books are
 * listed apart from the live ones because they are no longer part of it.
 */
export function BookSettings({ ledgerId, initialBooks }: BookSettingsProps) {
  const t = useTranslations("Settings.Books");
  const tCommon = useTranslations("Common");
  const tQueryError = useTranslations("LedgerQueryError");
  const [deviceTimeZone, setDeviceTimeZone] = useState<string | null>(null);
  const { books, booksQuery } = useBooks({
    ledgerId,
    ...(initialBooks !== undefined ? { initialBooks } : {}),
    includeArchived: true,
  });
  const { createBook, updateBook, reorderBooks, archiveBook, restoreBook, deleteBook } =
    useBookMutations(ledgerId);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<BookDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BookDto | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setDeviceTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
      } catch {
        setDeviceTimeZone(null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const all = books ?? [];
  const list = all.filter((book) => book.archivedAt == null);
  const archived = all.filter((book) => book.archivedAt != null);
  // Three distinct states, and none of them may be mistaken for "no books":
  // nothing has arrived yet, nothing arrived and the request failed, or the
  // list is showing while a background refresh failed.
  const isLoadingBooks = books === undefined && booksQuery.isPending;
  const booksLoadFailed = books === undefined && booksQuery.isLoadingError;
  const booksRefreshFailed = books !== undefined && booksQuery.isRefetchError;
  const retryBooks = () => void booksQuery.refetch();
  const busy =
    createBook.isPending ||
    updateBook.isPending ||
    reorderBooks.isPending ||
    archiveBook.isPending ||
    restoreBook.isPending ||
    deleteBook.isPending;

  const move = (index: number, delta: number) => {
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const current = next[index]!;
    next[index] = next[target]!;
    next[target] = current;
    reorderBooks.mutate(next.map((book) => book.id));
  };

  const startRename = (book: BookDto) => {
    setRenamingId(book.id);
    setRenameDraft(book.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameDraft("");
  };

  /**
   * A name is one field of a book that already exists, so it is written the
   * moment it is committed, the way the zone and the order above already are.
   * A refusal — a taken name, a name the server trims to nothing — is a toast
   * from the mutation, and the row stays open on the rejected draft so it can
   * be corrected instead of retyped.
   */
  const commitRename = (book: BookDto) => {
    const name = renameDraft.trim();
    if (name === "" || name === book.name) {
      cancelRename();
      return;
    }
    updateBook.mutate({ bookId: book.id, name }, { onSuccess: cancelRename });
  };

  // 自动 resolves to the device on this screen, so the reader sees which zone a
  // null book actually means before saving anything.
  const deviceZoneOption = deviceTimeZone ?? t("timeZoneAuto");

  /**
   * A zone that the migration carried over from the old per-person column can be
   * any IANA name, not one of the eleven offered here. Without the extra option
   * the picker would render the empty placeholder and silently invite the reader
   * to overwrite a zone they never chose.
   */
  const zoneOptionsFor = (book: BookDto) => {
    const zone = book.timeZone;
    return zone != null && !(TIME_ZONES as readonly string[]).includes(zone)
      ? [zone, ...TIME_ZONES]
      : TIME_ZONES;
  };

  return (
    <SettingsSection
      title={t("title")}
      actions={
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => {
            setNewName("");
            setIsAddOpen(true);
          }}
        >
          {t("add")}
        </Button>
      }
    >
      <div className="space-y-2">
        {booksRefreshFailed ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 border border-danger/30 bg-danger/10 px-3 py-2 text-sm"
          >
            <span>{tQueryError("description")}</span>
            <Button type="button" variant="outline" size="sm" onClick={retryBooks}>
              <RefreshCw className="size-4" />
              {tQueryError("retry")}
            </Button>
          </div>
        ) : null}
        {booksLoadFailed ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 border border-danger/30 bg-danger/10 px-3 py-2 text-sm"
          >
            <span>{tQueryError("description")}</span>
            <Button type="button" variant="outline" size="sm" onClick={retryBooks}>
              <RefreshCw className="size-4" />
              {tQueryError("retry")}
            </Button>
          </div>
        ) : isLoadingBooks ? (
          <ul
            role="status"
            aria-label={tCommon("loading")}
            className="divide-y divide-border rounded-[var(--radius)] border border-border"
          >
            {[0, 1].map((row) => (
              <li key={row} className="p-3">
                <span className="block h-4 w-24 animate-pulse rounded-sm bg-surface2" />
              </li>
            ))}
          </ul>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
            {list.map((book, index) => {
              const renaming = renamingId === book.id;
              return (
                <li key={book.id} className="flex flex-wrap items-center gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    {renaming ? (
                      <Input
                        autoFocus
                        value={renameDraft}
                        maxLength={20}
                        autoComplete="off"
                        aria-label={t("rename", { name: book.name })}
                        disabled={updateBook.isPending}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitRename(book);
                            return;
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRename();
                          }
                        }}
                        className="h-8"
                      />
                    ) : (
                      <span className="truncate text-sm font-medium text-text">{book.name}</span>
                    )}
                    <p className="mt-0.5 text-micro text-muted-foreground">
                      {book.timeZone ?? deviceZoneOption}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {renaming ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={renameDraft.trim() === "" || updateBook.isPending}
                          aria-label={tCommon("save")}
                          title={tCommon("save")}
                          onClick={() => commitRename(book)}
                        >
                          <Check className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={updateBook.isPending}
                          aria-label={tCommon("cancel")}
                          title={tCommon("cancel")}
                          onClick={cancelRename}
                        >
                          <X className="size-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy || index === 0}
                          aria-label={t("moveUp", { name: book.name })}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy || index === list.length - 1}
                          aria-label={t("moveDown", { name: book.name })}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy}
                          aria-label={t("rename", { name: book.name })}
                          title={t("rename", { name: book.name })}
                          onClick={() => startRename(book)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy}
                          aria-label={t("archive")}
                          title={t("archive")}
                          className="text-muted-foreground hover:text-danger"
                          onClick={() => setArchiveTarget(book)}
                        >
                          <Archive className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy}
                          aria-label={t("delete")}
                          title={t("delete")}
                          className="text-muted-foreground hover:text-danger"
                          onClick={() => setDeleteTarget(book)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    )}
                  </div>
                  <div className="w-full sm:w-56">
                    <Select
                      value={book.timeZone ?? "auto"}
                      onValueChange={(value) =>
                        updateBook.mutate({
                          bookId: book.id,
                          timeZone: value === "auto" ? null : value,
                        })
                      }
                      disabled={busy}
                    >
                      <SelectTrigger aria-label={t("timeZone")} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="auto">
                          {t("timeZoneAutoDetected", { timeZone: deviceZoneOption })}
                        </SelectItem>
                        {zoneOptionsFor(book).map((timeZone) => (
                          <SelectItem key={timeZone} value={timeZone}>
                            {timeZone}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {archived.length > 0 ? (
        <SettingsField title={t("archivedSection")} stacked>
          <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
            {archived.map((book) => (
              <li key={book.id} className="flex flex-wrap items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-muted-foreground">
                      {book.name}
                    </span>
                    <span className="shrink-0 rounded-sm border border-border bg-surface2 px-1.5 py-0.5 text-micro font-medium text-muted-foreground">
                      {t("archivedBadge")}
                    </span>
                  </div>
                  <p className="mt-0.5 text-micro text-muted-foreground">
                    {book.timeZone ?? deviceZoneOption}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => restoreBook.mutate(book.id)}
                >
                  <ArchiveRestore className="mr-1 size-4" />
                  {t("restore")}
                </Button>
              </li>
            ))}
          </ul>
        </SettingsField>
      ) : null}

      <Dialog open={isAddOpen} onOpenChange={(open) => !createBook.isPending && setIsAddOpen(open)}>
        <DialogContent variant="modal">
          <DialogHeader>
            <DialogTitle>{t("addTitle")}</DialogTitle>
            <DialogDescription>{t("addDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="new-book-name">{t("name")}</Label>
            <Input
              id="new-book-name"
              value={newName}
              maxLength={20}
              autoComplete="off"
              placeholder={t("namePlaceholder")}
              disabled={createBook.isPending}
              onChange={(event) => setNewName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsAddOpen(false)}
              disabled={createBook.isPending}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              disabled={newName.trim() === "" || createBook.isPending}
              onClick={() =>
                createBook.mutate(
                  { name: newName.trim(), timeZone: null },
                  { onSuccess: () => setIsAddOpen(false) }
                )
              }
            >
              {t("add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={archiveTarget != null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={t("archiveTitle", { name: archiveTarget?.name ?? "" })}
        description={t("archiveDesc")}
        confirmLabel={t("archive")}
        variant="destructive"
        onConfirm={() => {
          if (archiveTarget == null) return false;
          archiveBook.mutate(archiveTarget.id);
          setArchiveTarget(null);
          return true;
        }}
      />

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("deleteTitle", { name: deleteTarget?.name ?? "" })}
        description={t("deleteDesc")}
        confirmLabel={t("delete")}
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget == null) return false;
          deleteBook.mutate(deleteTarget.id);
          setDeleteTarget(null);
          return true;
        }}
      />
    </SettingsSection>
  );
}
