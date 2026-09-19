"use client";
import { memo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  title: string;
  description: string;
  onConfirm: (onCommitted: () => void) => void | boolean | Promise<void | boolean>;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  onSave?: () => void | boolean | Promise<void | boolean>;
  saveLabel?: string;
  onDiscard?: () => void | boolean | Promise<void | boolean>;
  discardLabel?: string;
}

import { useTranslations } from "next-intl";

export const ConfirmDialog = memo(function ConfirmDialog({
  title,
  description,
  onConfirm,
  trigger,
  open,
  onOpenChange,
  confirmLabel,
  cancelLabel,
  variant = "default",
  onSave,
  saveLabel,
  onDiscard,
  discardLabel,
}: ConfirmDialogProps) {
  const t = useTranslations("Common");
  const [isPending, setIsPending] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const pendingRef = useRef(false);
  const setOpen = (nextOpen: boolean) => {
    setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const displayConfirmLabel = confirmLabel ?? t("confirm");
  const displayCancelLabel = cancelLabel ?? t("cancel");
  const displaySaveLabel = saveLabel ?? t("save");
  const displayDiscardLabel = discardLabel ?? t("discard");

  // Check if we're using the three-button layout (for unsaved changes dialog)
  const hasThreeButtonLayout = onSave != null || onDiscard != null;
  const dialogProps = {
    open: open ?? internalOpen,
    onOpenChange: (nextOpen: boolean) => !pendingRef.current && setOpen(nextOpen),
  };
  const footerProps = hasThreeButtonLayout
    ? { className: "justify-between sm:justify-between" }
    : {};

  return (
    <Dialog {...dialogProps}>
      {trigger != null && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        variant="modal"
        onEscapeKeyDown={(event) => isPending && event.preventDefault()}
        onPointerDownOutside={(event) => isPending && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter {...footerProps}>
          {hasThreeButtonLayout && onDiscard && (
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={async (e) => {
                e.stopPropagation();
                if (pendingRef.current) return;
                pendingRef.current = true;
                setIsPending(true);
                try {
                  const shouldClose = await onDiscard();
                  if (shouldClose !== false) setOpen(false);
                } catch {
                  // The owning mutation reports the error; keep this dialog open.
                } finally {
                  pendingRef.current = false;
                  setIsPending(false);
                }
              }}
            >
              {displayDiscardLabel}
            </Button>
          )}
          <div className="flex gap-2 justify-end">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isPending}>
                {displayCancelLabel}
              </Button>
            </DialogClose>
            {hasThreeButtonLayout && onSave ? (
              <Button
                type="button"
                disabled={isPending}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (pendingRef.current) return;
                  pendingRef.current = true;
                  setIsPending(true);
                  try {
                    const shouldClose = await onSave();
                    if (shouldClose !== false) setOpen(false);
                  } catch {
                    // The owning mutation reports the error; keep this dialog open.
                  } finally {
                    pendingRef.current = false;
                    setIsPending(false);
                  }
                }}
              >
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {displaySaveLabel}
              </Button>
            ) : (
              <Button
                type="button"
                variant={variant}
                disabled={isPending}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (pendingRef.current) return;
                  pendingRef.current = true;
                  setIsPending(true);
                  try {
                    let closed = false;
                    const close = () => {
                      if (closed) return;
                      closed = true;
                      setOpen(false);
                    };
                    const shouldClose = await onConfirm(close);
                    if (shouldClose !== false) close();
                  } catch {
                    // The owning mutation reports the error; keep this dialog open.
                  } finally {
                    pendingRef.current = false;
                    setIsPending(false);
                  }
                }}
              >
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {displayConfirmLabel}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
