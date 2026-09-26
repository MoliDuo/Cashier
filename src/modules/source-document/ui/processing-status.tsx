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
 * A card's state, spoken rather than printed. The card's own surface carries it
 * — see the tone on `EntryCardShell` — so this keeps the state reachable
 * instead of visible: a live region names it for assistive tech, and a failure
 * still shows the one word that says what went wrong, because a colour cannot
 * name a reason.
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
      {isFailure ? (
        <span
          className="max-w-32 truncate text-xs font-medium text-danger sm:max-w-48"
          data-testid="status-label"
          title={displayLabel}
        >
          {displayLabel}
        </span>
      ) : (
        <span className="sr-only">{displayLabel}</span>
      )}
    </div>
  );
}
