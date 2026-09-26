"use client";
import { Button } from "@/components/ui/button";
import { DateFilter } from "@/components/ui/date-filter";
import { formatDateTimeForApi } from "@/lib/date-utils";
import type { BatchEntryDateImpact } from "@/modules/ledger/contracts";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { commonCopy } from "@/copy/common";
import { batchActionsCopy } from "@/copy/workspace";

export interface BatchDateImpactSummary {
  selected: number;
  documents: number;
  entries: number;
}

/** Reads a ledger date-impact preview into the dialog's own summary shape, so
 * each surface does not re-map the same three counts. */
export function batchDateImpactSummary(impact: BatchEntryDateImpact): BatchDateImpactSummary {
  return {
    selected: impact.selectedEntryCount,
    documents: impact.sourceDocumentCount,
    entries: impact.affectedEntryCount,
  };
}

interface BatchDateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Civil date (YYYY-MM-DD) the field starts on. */
  value: string;
  onChange: (value: string) => void;
  timeZone?: string;
  /** Null until the preview answers. */
  impact: BatchDateImpactSummary | null;
  isPreviewing: boolean;
  previewFailed: boolean;
  onRetryPreview: () => void;
  /** The selection moved after the preview; confirming would act on something
   * other than what was previewed. */
  selectionChanged: boolean;
  /** A caveat about the scope, as display text, e.g. that only loaded rows
   * are selected. */
  scopeNote?: string;
  isConfirming: boolean;
  onConfirm: () => void;
}

/**
 * The one way to change the date of a selection. The day and the preview of
 * what it touches live in the same dialog, so the figure being proposed and the
 * figure the change lands on are read together instead of across two steps, and
 * the field is the shared DateFilter every other single-day field uses.
 */
export function BatchDateDialog({
  open,
  onOpenChange,
  value,
  onChange,
  timeZone,
  impact,
  isPreviewing,
  previewFailed,
  onRetryPreview,
  selectionChanged,
  scopeNote,
  isConfirming,
  onConfirm,
}: BatchDateDialogProps) {
  const isPending = isConfirming || isPreviewing;
  const requestClose = (nextOpen: boolean) => {
    if (isPending) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        variant="modal"
        onEscapeKeyDown={(event) => isPending && event.preventDefault()}
        onPointerDownOutside={(event) => isPending && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{batchActionsCopy.dateImpactTitle}</DialogTitle>
        </DialogHeader>
        {selectionChanged ? (
          <p className="text-sm text-muted-foreground">{batchActionsCopy.selectionChanged}</p>
        ) : previewFailed ? (
          <p className="text-sm text-destructive" role="alert">
            {batchActionsCopy.dateImpactFailed}
          </p>
        ) : impact != null ? (
          <p className="text-sm text-muted-foreground">
            {batchActionsCopy.dateImpactDescription({
              documents: impact.documents,
              entries: impact.entries,
              scope: scopeNote ?? "",
            })}
          </p>
        ) : null}
        {/* The field never empties, so it offers no clear. */}
        <DateFilter
          value={value}
          onChange={(date) => {
            const civilDate = date == null ? null : formatDateTimeForApi(date);
            if (civilDate != null) onChange(civilDate);
          }}
          className="w-full"
          showClear={false}
          showClearShortcut={false}
          ariaLabel={batchActionsCopy.setDate}
          // The field is seeded from this timezone, so it must read the day
          // back against the same one.
          {...(timeZone != null ? { timeZone } : {})}
        />
        <DialogFooter>
          <Button variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
            {commonCopy.cancel}
          </Button>
          {previewFailed ? (
            <Button disabled={isPreviewing} onClick={onRetryPreview}>
              {batchActionsCopy.retryImpact}
            </Button>
          ) : (
            <Button disabled={isPending || selectionChanged || value === ""} onClick={onConfirm}>
              {commonCopy.confirm}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
