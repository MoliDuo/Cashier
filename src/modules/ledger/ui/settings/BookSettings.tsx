"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Archive, Plus, Star } from "lucide-react";
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
  initialBooks: readonly BookDto[];
}

/**
 * 分账: reorder, add, rename, archive, pick the 总账 default and set a zone. The
 * order here is the order of the pull-down switcher.
 */
export function BookSettings({ ledgerId, initialBooks }: BookSettingsProps) {
  const t = useTranslations("Settings.Books");
  const tCommon = useTranslations("Common");
  const [deviceTimeZone, setDeviceTimeZone] = useState<string | null>(null);
  const { books } = useBooks({ ledgerId, initialBooks });
  const { createBook, updateBook, reorderBooks, setDefaultBook, archiveBook } =
    useBookMutations(ledgerId);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameTarget, setRenameTarget] = useState<BookDto | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<BookDto | null>(null);

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

  const list = books ?? [];
  const busy =
    createBook.isPending ||
    updateBook.isPending ||
    reorderBooks.isPending ||
    setDefaultBook.isPending ||
    archiveBook.isPending;

  const move = (index: number, delta: number) => {
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const current = next[index]!;
    next[index] = next[target]!;
    next[target] = current;
    reorderBooks.mutate(next.map((book) => book.id));
  };

  // 自动 resolves to the device on this screen, so the reader sees which zone a
  // null book actually means before saving anything.
  const deviceZoneOption = deviceTimeZone ?? t("timeZoneAuto");

  return (
    <SettingsSection title={t("title")} description={t("description")}>
      <SettingsField title={t("name")} stacked>
        <div className="space-y-2">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
              {list.map((book, index) => (
                <li key={book.id} className="flex flex-wrap items-center gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-text">{book.name}</span>
                      {book.isDefault ? (
                        <span className="shrink-0 rounded-sm border border-primary/40 bg-primary/5 px-1.5 py-0.5 text-micro font-medium text-primary">
                          {t("totalBadge")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-micro text-muted-foreground">
                      {book.timeZone ?? deviceZoneOption}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
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
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setRenameTarget(book);
                        setRenameDraft(book.name);
                      }}
                    >
                      {t("rename")}
                    </Button>
                    {!book.isDefault ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
                        aria-label={t("setDefault")}
                        title={t("setDefault")}
                        onClick={() => setDefaultBook.mutate(book.id)}
                      >
                        <Star className="size-4" />
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy || book.isDefault}
                      aria-label={t("archive")}
                      title={t("archive")}
                      className="text-muted-foreground hover:text-danger"
                      onClick={() => setArchiveTarget(book)}
                    >
                      <Archive className="size-4" />
                    </Button>
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
                        {TIME_ZONES.map((timeZone) => (
                          <SelectItem key={timeZone} value={timeZone}>
                            {timeZone}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              setNewName("");
              setIsAddOpen(true);
            }}
          >
            <Plus className="mr-1 size-4" />
            {t("add")}
          </Button>
        </div>
      </SettingsField>
      <SettingsField title={t("default")} description={t("defaultDesc")}>
        <p className="text-sm text-text sm:text-right">
          {list.find((book) => book.isDefault)?.name ?? "—"}
        </p>
      </SettingsField>

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
              variant="ghost"
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

      <Dialog
        open={renameTarget != null}
        onOpenChange={(open) => !updateBook.isPending && (open ? undefined : setRenameTarget(null))}
      >
        <DialogContent variant="modal">
          <DialogHeader>
            <DialogTitle>{t("renameTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="rename-book-name">{t("name")}</Label>
            <Input
              id="rename-book-name"
              value={renameDraft}
              maxLength={20}
              disabled={updateBook.isPending}
              onChange={(event) => setRenameDraft(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRenameTarget(null)}
              disabled={updateBook.isPending}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              disabled={renameDraft.trim() === "" || updateBook.isPending}
              onClick={() => {
                if (renameTarget == null) return;
                updateBook.mutate(
                  { bookId: renameTarget.id, name: renameDraft.trim() },
                  { onSuccess: () => setRenameTarget(null) }
                );
              }}
            >
              {t("rename")}
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
    </SettingsSection>
  );
}
