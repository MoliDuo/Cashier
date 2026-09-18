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
import { useLocale, useTranslations } from "next-intl";
import { formatInstantDateLabel } from "@/lib/date-utils";
import { copyToClipboard } from "@/lib/utils";
import { UI } from "@/lib/constants";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

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
  const locale = useLocale();
  const defaultBookId = books.find((book) => book.isDefault)?.id ?? books[0]?.id ?? "";
  const [newCredName, setNewCredName] = useState("");
  const [newCredBookId, setNewCredBookId] = useState(defaultBookId);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [credentialToDelete, setCredentialToDelete] = useState<ServiceCredential | null>(null);
  const [createdCredential, setCreatedCredential] = useState<CreatedServiceCredentialDto | null>(
    null
  );
  const [hasCopied, setHasCopied] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const openCreateDialog = () => {
    // Each opening starts from the current default book, not the last choice.
    setNewCredBookId(defaultBookId);
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
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-text">{t("title")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button onClick={openCreateDialog} size="sm" disabled={isCreating || isDeleting}>
          {t("newCredential")}
        </Button>
      </div>

      <div className="space-y-3">
        {credentials.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-dashed border-border py-8 text-center text-muted-foreground">
            {t("noCredentials")}
          </div>
        ) : (
          credentials.map((credential) => (
            <div
              key={credential.id}
              className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-surface2 p-4"
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{credential.name}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {credential.tokenPrefix && credential.tokenSuffix
                      ? `${credential.tokenPrefix}...${credential.tokenSuffix}`
                      : "******"}
                  </div>
                  <div className="mt-1 text-micro text-muted-foreground">
                    {t("createdAt", {
                      date: formatInstantDateLabel(credential.createdAt, locale, {
                        today: tCommon("today"),
                        yesterday: tCommon("yesterday"),
                      }),
                    })}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="shrink-0 text-micro text-muted-foreground">
                      {t("book", { book: bookName(credential.bookId) })}
                    </span>
                    <Select
                      value={credential.bookId}
                      onValueChange={(bookId) => void onSetCredentialBook(credential.id, bookId)}
                      disabled={isCreating || isDeleting}
                    >
                      <SelectTrigger
                        className="h-7 w-36 text-xs"
                        aria-label={t("changeBook", { name: credential.name })}
                      >
                        <SelectValue />
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
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                disabled={isCreating || isDeleting}
                onClick={() => setCredentialToDelete(credential)}
                aria-label={t("deleteButton", { name: credential.name })}
                className="shrink-0 text-muted-foreground hover:text-danger"
              >
                <Trash2 size={16} />
              </Button>
            </div>
          ))
        )}
      </div>

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
              variant="ghost"
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
    </div>
  );
}
