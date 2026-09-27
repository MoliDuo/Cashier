import { cn } from "@/lib/utils";
import { commonCopy } from "@/copy/common";
import { sourceDocumentCardCopy } from "@/copy/source-document";

type ProcessingStatusType = "processing" | "completed" | "error" | "cancelled";

interface ProcessingStatusProps {
  status: ProcessingStatusType;
  /** Why the document failed, when that is known. */
  label?: string;
  className?: string;
}

/**
 * A card's state. The card's surface carries its tone (see `EntryCardShell`),
 * but a tone alone cannot say what it means, so every state that is not the
 * normal one is also printed: 处理中 while the AI works, 已取消 for a stopped
 * run, and the failure's own reason. A completed card needs no word; its state
 * stays reachable to assistive tech through the live region.
 */
export function ProcessingStatus({ status, label, className }: ProcessingStatusProps) {
  const stateLabel =
    status === "processing"
      ? sourceDocumentCardCopy.processing
      : status === "completed"
        ? sourceDocumentCardCopy.completed
        : status === "cancelled"
          ? sourceDocumentCardCopy.cancelled
          : commonCopy.error;

  const isFailure = status === "error";
  const displayLabel = isFailure ? (label ?? stateLabel) : stateLabel;

  return (
    <div
      className={cn("flex min-w-0 items-center", className)}
      role={isFailure ? "alert" : "status"}
      aria-live={isFailure ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {status === "completed" ? (
        <span className="sr-only">{displayLabel}</span>
      ) : (
        <span
          className={cn(
            "max-w-32 truncate text-xs font-medium sm:max-w-48",
            isFailure && "text-danger",
            status === "processing" && "text-primary",
            status === "cancelled" && "text-muted-foreground"
          )}
          data-testid="status-label"
          title={displayLabel}
        >
          {displayLabel}
        </span>
      )}
    </div>
  );
}
