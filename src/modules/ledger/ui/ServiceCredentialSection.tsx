"use client";
import { useEffect, useState } from "react";
import { Trash2, Copy, Check } from "lucide-react";
import type {
  BookDto,
  ServiceCredential,
  CreatedServiceCredentialDto,
} from "@/modules/ledger/contracts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useTranslations } from "next-intl";
import { formatInstantDateLabel } from "@/lib/date-utils";
import { copyToClipboard } from "@/lib/utils";
import { UI, DISPLAY_LOCALE } from "@/lib/constants";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SettingsSection } from "./settings/SettingsSection";

interface ServiceCredentialSectionProps {
  credentials: ServiceCredential[];
  /** The live books; a key's book can be picked at creation and changed later. */
  books: readonly BookDto[];
  onCreateCredential: (input: {
    name: string;
    bookId: string;
  }) => Promise<CreatedServiceCredentialDto>;
  onSetCredentialBook: (id: string, bookId: string) => Promise<void>;
  onDeleteCredential: (id: string) => Promise<void>;
  onCredentialDialogClose?: () => void;
}

export function ServiceCredentialSection({
  credentials,
  books,
  onCreateCredential,
  onSetCredentialBook,
  onDeleteCredential,
  onCredentialDialogClose,
}: ServiceCredentialSectionProps) {
  const tBooks = useTranslations("Settings.Books");
  const t = useTranslations("ServiceCredentials");
  const tCommon = useTranslations("Common");
  const locale = DISPLAY_LOCALE;
  const firstBookId = books[0]?.id ?? "";
  const [newCredName, setNewCredName] = useState("");
  const [newCredBookId, setNewCredBookId] = useState(firstBookId);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [credentialToDelete, setCredentialToDelete] = useState<ServiceCredential | null>(null);
  const [createdCredential, setCreatedCredential] = useState<CreatedServiceCredentialDto | null>(
    null
  );
  const [hasCopied, setHasCopied] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const openCreateDialog = () => {
    // Each opening starts from the first book in 设置 order, not the last choice.
    setNewCredBookId(firstBookId);
    setIsCreateDialogOpen(true);
  };

  useEffect(() => {
    if (!hasCopied) return;

    const timer = setTimeout(() => setHasCopied(false), UI.COPY_FEEDBACK_DURATION_MS);
    return () => clearTimeout(timer);
  }, [hasCopied]);

  const handleCreate = async () => {
    if (newCredName.trim() === "" || newCredBookId === "" || isCreating) return;

    setIsCreating(true);
    try {
      const newCredential = await onCreateCredential({
        name: newCredName.trim(),
        bookId: newCredBookId,
      });
      setCreatedCredential(newCredential);
      setNewCredName("");
      setIsCreateDialogOpen(false);
    } catch (error) {
      console.error("Failed to create credential", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = async (text: string) => {
    const success = await copyToClipboard(text);

    if (success) {
      setHasCopied(true);
      toast.success(t("copied"));
      return;
    }

    toast.error(tCommon("error"));
  };

  const closeCreatedCredentialDialog = () => {
    setCreatedCredential(null);
    setHasCopied(false);
    onCredentialDialogClose?.();
  };

  // A key whose book is gone (archived behind its back) still lists, and says
  // so rather than showing an empty name or a generic error.
  const bookName = (bookId: string) =>
    books.find((book) => book.id === bookId)?.name ?? t("archivedBook");

  return (
    <SettingsSection
      title={t("title")}
      actions={
        <Button onClick={openCreateDialog} size="sm" disabled={isCreating || isDeleting}>
          {t("newCredential")}
        </Button>
      }
    >
      {credentials.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          {t("noCredentials")}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
          {credentials.map((credential) => (
            <li key={credential.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text">
                  {credential.name}
                </span>
                <p className="mt-0.5 truncate text-micro">
                  <span className="font-mono">
                    {credential.tokenPrefix && credential.tokenSuffix
                      ? `${credential.tokenPrefix}...${credential.tokenSuffix}`
                      : "******"}
                  </span>
                  <span aria-hidden> · </span>
                  {t("createdAt", {
                    date: formatInstantDateLabel(credential.createdAt, locale, {
                      today: tCommon("today"),
                      yesterday: tCommon("yesterday"),
                    }),
                  })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {/* The picker names its own book, so the row states it once; a key
                    whose book is gone still names itself as archived here. */}
                <Select
                  value={credential.bookId}
                  onValueChange={(bookId) => void onSetCredentialBook(credential.id, bookId)}
                  disabled={isCreating || isDeleting}
                >
                  <SelectTrigger
                    className="max-w-40"
                    aria-label={t("changeBook", { name: credential.name })}
                  >
                    <SelectValue>{bookName(credential.bookId)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {books.map((book) => (
                      <SelectItem key={book.id} value={book.id}>
                        {book.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={isCreating || isDeleting}
                  onClick={() => setCredentialToDelete(credential)}
                  aria-label={t("deleteButton", { name: credential.name })}
                  title={t("deleteButton", { name: credential.name })}
                  className="text-muted-foreground hover:text-danger"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => !isCreating && setIsCreateDialogOpen(open)}
      >
        <DialogContent
          variant="modal"
          hideCloseButton={isCreating}
          onEscapeKeyDown={(event) => isCreating && event.preventDefault()}
          onPointerDownOutside={(event) => isCreating && event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>{t("createDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder={t("namePlaceholder")}
              aria-label={t("namePlaceholder")}
              name="credentialName"
              autoComplete="off"
              value={newCredName}
              disabled={isCreating}
              onChange={(event) => setNewCredName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && handleCreate()}
            />
            <div className="space-y-2">
              <Label htmlFor="credential-book">{tCommon("book")}</Label>
              <Select value={newCredBookId} onValueChange={setNewCredBookId} disabled={isCreating}>
                <SelectTrigger id="credential-book" className="w-full">
                  <SelectValue placeholder={tBooks("namePlaceholder")} />
                </SelectTrigger>
                <SelectContent position="popper">
                  {books.map((book) => (
                    <SelectItem key={book.id} value={book.id}>
                      {book.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-micro text-muted-foreground">{t("bookDesc")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              disabled={isCreating}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={newCredName.trim() === "" || newCredBookId === "" || isCreating}
            >
              {tCommon("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createdCredential != null}>
        <DialogContent
          variant="modal"
          hideCloseButton
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t("createSuccessTitle")}</DialogTitle>
            <DialogDescription>{t("createSuccessDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="group relative break-all rounded border bg-surface p-4 font-mono text-sm">
              {createdCredential?.token}
              <Button
                size="sm"
                variant="outline"
                className="absolute right-2 top-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                onClick={() => handleCopy(createdCredential?.token ?? "")}
              >
                {hasCopied ? (
                  <Check size={14} className="mr-1" />
                ) : (
                  <Copy size={14} className="mr-1" />
                )}
                {hasCopied ? tCommon("success") : t("copy")}
              </Button>
            </div>
            <Button
              className="w-full gap-2"
              onClick={() => handleCopy(createdCredential?.token ?? "")}
              variant={hasCopied ? "outline" : "default"}
            >
              {hasCopied ? <Check size={16} /> : <Copy size={16} />}
              {hasCopied ? tCommon("success") : t("copyCredential")}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={closeCreatedCredentialDialog}>{t("saved")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={credentialToDelete != null}
        onOpenChange={(open) => !open && setCredentialToDelete(null)}
        title={t("deleteTitle")}
        description={t("deleteDesc", { name: credentialToDelete?.name ?? "" })}
        confirmLabel={tCommon("delete")}
        variant="destructive"
        onConfirm={async () => {
          if (credentialToDelete == null || isDeleting) return;
          setIsDeleting(true);
          try {
            await onDeleteCredential(credentialToDelete.id);
            setCredentialToDelete(null);
          } finally {
            setIsDeleting(false);
          }
        }}
      />
    </SettingsSection>
  );
}
