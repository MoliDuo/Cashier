"use client";

import type { ComponentType, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { TOOLBAR_CONTROL_CLASS } from "@/components/toolbar-control";
import { cn } from "@/lib/utils";

export interface BatchActionButtonProps extends Omit<ButtonProps, "children"> {
  icon: ComponentType<{ className?: string }>;
  loading?: boolean;
  /**
   * Narrower label for the mobile row. Without one the button keeps a single
   * label at every width; with one, the wide label is what a screen reader
   * reads, so the short form has to be contained in it.
   */
  shortLabel?: string;
  children: ReactNode;
}

/**
 * Shared visual contract for batch actions across stream, details, and
 * source-document detail views.
 */
export function BatchActionButton({
  icon: Icon,
  loading = false,
  shortLabel,
  children,
  className,
  disabled,
  ...props
}: BatchActionButtonProps) {
  return (
    <Button
      size="sm"
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      // A phone row has to fit four actions beside the back button at 360px;
      // the toolbar tier's padding would push the fourth onto its own line.
      className={cn(TOOLBAR_CONTROL_CLASS, "gap-1 px-2 sm:gap-1.5 sm:px-2.5", className)}
      {...props}
    >
      {loading ? (
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      ) : (
        <Icon aria-hidden="true" className="size-4" />
      )}
      {shortLabel == null ? (
        <span>{children}</span>
      ) : (
        <>
          <span className="hidden sm:inline">{children}</span>
          <span className="sm:hidden">{shortLabel}</span>
        </>
      )}
    </Button>
  );
}
