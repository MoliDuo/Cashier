"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface CredentialChangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  triggerLabel: string;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
  desktopWidth: "md" | "lg";
}

export function CredentialChangeDialog({
  open,
  onOpenChange,
  pending,
  triggerLabel,
  title,
  description,
  children,
  footer,
  desktopWidth,
}: CredentialChangeDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && pending) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent
        variant="detail"
        hideCloseButton={pending}
        onEscapeKeyDown={(event) => pending && event.preventDefault()}
        onPointerDownOutside={(event) => pending && event.preventDefault()}
        className={cn(
          "flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100vw-2rem)] sm:rounded-lg",
          desktopWidth === "md" ? "sm:max-w-md" : "sm:max-w-lg"
        )}
      >
        <DialogHeader className="shrink-0 border-b px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:py-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-4 sm:px-6">
          {children}
        </div>
        <DialogFooter className="shrink-0 gap-2 border-t px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:py-4">
          {footer}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
