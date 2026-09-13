import type { LedgerEntry } from "@/modules/ledger/contracts";
import type {
  SourceDocument,
  SourceDocumentLight,
  SourceDocumentListItemDto,
  SourceDocumentProcessingStatus,
} from "@/modules/source-document/contracts";
import type { SupportedSourceDocumentAction } from "@/application/contracts";
import { memo, useRef } from "react";
import { ChevronDown, CircleStop, MoreVertical, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { textRoleClassName } from "@/components/typography";
import { ProcessingStatus } from "./processing-status";
import { SourceDocumentCardTotal } from "./SourceDocumentCardTotal";
import type {
  ApplicationErrorCode,
  ProcessingFailureCode,
  RevisionFailureKind,
} from "@/application/contracts";
import { toStableFailureCode } from "@/application/contracts";
import { useDiagnosticMessages } from "./use-diagnostic-messages";

interface SourceDocumentCardHeaderProps {
  sourceDocument: SourceDocument | SourceDocumentLight | SourceDocumentListItemDto;
  processingStatus: SourceDocumentProcessingStatus | null;
  failureKind?: RevisionFailureKind | null | undefined;
  errorCode?: ApplicationErrorCode | ProcessingFailureCode | null | undefined;
  ledgerEntries: LedgerEntry[];
  mainCurrency: string;
  isRetrying: boolean;
  isCancelling: boolean;
  selectionMode: boolean;
  supportedActions: readonly SupportedSourceDocumentAction[];
  showActions?: boolean;
  isExpanded: boolean;
  hasExpandableContent?: boolean;
  contentId: string;
  onToggleExpanded: () => void;
  onViewDetails?: (() => void) | undefined;
  onViewDetailsIntent?: (() => void) | undefined;
  onDirectRetry?: (() => void | Promise<void>) | undefined;
  onCancelProcessing?: (() => void | Promise<void>) | undefined;
  onEditRetry?: (() => void | Promise<void>) | undefined;
  onEditRetryIntent?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}

function getProcessingStatus(status: SourceDocumentProcessingStatus | null) {
  if (status === "failed") {
    return "error" as const;
  }

  if (status === "processing" || status === "completed" || status === "cancelled") {
    return status;
  }

  return null;
}

export const SourceDocumentCardHeader = memo(function SourceDocumentCardHeader({
  sourceDocument,
  processingStatus: status,
  failureKind,
  errorCode,
  ledgerEntries,
  mainCurrency,
  isRetrying,
  isCancelling,
  selectionMode,
  supportedActions,
  showActions = true,
  isExpanded,
  hasExpandableContent = true,
  contentId,
  onToggleExpanded,
  onViewDetails,
  onViewDetailsIntent,
  onDirectRetry,
  onCancelProcessing,
  onEditRetry,
  onEditRetryIntent,
  onDelete,
}: SourceDocumentCardHeaderProps) {
  const t = useTranslations("SourceDocumentCard");
  const tCommon = useTranslations("Common");
  const tActions = useTranslations("SourceDocumentAction");
  const diagnosticMessages = useDiagnosticMessages();
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const processingStatus = getProcessingStatus(status);
  // The card's surface says which state the document is in, so the only state
  // worth words here is a failure, which has to name its reason. Everything
  // else is announced to assistive tech and left unprinted.
  const shouldAnnounceStatus = processingStatus != null;
  const shouldShowTotal = ledgerEntries.length > 0;

  // A failed document shows one stable label: a document the AI could not turn
  // into entries reads as unparsable, everything else by its failure code. The
  // AI-written reason is too long for this badge and lives in the detail panel.
  const failureLabel =
    status === "failed"
      ? failureKind === "invalid_input"
        ? diagnosticMessages.unparsableLabel
        : diagnosticMessages.label(toStableFailureCode(errorCode))
      : null;

  const hasAction = (action: SupportedSourceDocumentAction) => supportedActions.includes(action);

  return (
    <div
      className={cn(
        // The shell's 56px minimum is measured over its own 1px top and bottom
        // borders, so a header filling the full 56px would push a collapsed
        // card to 58px — 2px taller than the single-row entry cards it sits
        // beside in the details tab. What is left is one entry row's height,
        // which is the point: this header carries less than a row does.
        "flex h-[calc(var(--selectable-card-header-height,56px)-2px)] items-center gap-1 py-2 pr-2 sm:pr-3",
        selectionMode ? "pl-11" : "pl-2 sm:pl-3"
      )}
    >
      {hasExpandableContent && !selectionMode ? (
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color] duration-[var(--motion-feedback)]"
          aria-label={isExpanded ? t("collapse") : t("expand")}
          aria-expanded={isExpanded}
          aria-controls={contentId}
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform duration-[var(--motion-feedback)] ease-[var(--motion-state-ease)]",
              isExpanded && "rotate-180"
            )}
          />
        </button>
      ) : (
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center" />
      )}

      <button
        type="button"
        onClick={onViewDetails}
        onPointerEnter={onViewDetailsIntent}
        onPointerDown={onViewDetailsIntent}
        onFocus={onViewDetailsIntent}
        disabled={onViewDetails == null}
        className="group flex min-h-9 min-w-0 flex-1 items-center rounded-md px-2 py-1 text-left transition-[color,background-color] duration-[var(--motion-feedback)] focus-visible:outline-none disabled:cursor-default"
      >
        <span className="flex min-w-0 items-center gap-2 rounded-sm group-focus-visible:outline-2 group-focus-visible:-outline-offset-2 group-focus-visible:outline-ring">
          <span className={textRoleClassName("cardTitle", "truncate")}>
            {sourceDocument.title?.trim() || t("untitled")}
          </span>
        </span>
      </button>

      <div className="flex items-center gap-2 shrink-0">
        {shouldAnnounceStatus && (
          <ProcessingStatus
            status={processingStatus}
            {...(failureLabel != null ? { label: failureLabel } : {})}
          />
        )}

        {shouldShowTotal && (
          <div className="text-right">
            <SourceDocumentCardTotal entries={ledgerEntries} mainCurrency={mainCurrency} />
          </div>
        )}

        {showActions && (
          <div
            className="ml-1 flex items-center gap-1.5"
            onClick={(event) => event.stopPropagation()}
          >
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={menuTriggerRef}
                  variant="ghost"
                  size="icon-sm"
                  className="h-9 w-9 text-muted-foreground hover:text-text sm:h-8 sm:w-8"
                  aria-label={t("moreActions")}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-44"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  menuTriggerRef.current?.focus();
                }}
              >
                {/* Recovery actions for invalid/failed */}
                {hasAction("retry") && onDirectRetry != null && (
                  <DropdownMenuItem onClick={onDirectRetry} disabled={isRetrying}>
                    <RefreshCw className={cn("mr-2 h-4 w-4", isRetrying && "animate-spin")} />
                    {tActions("retry")}
                  </DropdownMenuItem>
                )}
                {hasAction("edit_retry") && onEditRetry != null && (
                  <DropdownMenuItem
                    onClick={onEditRetry}
                    onPointerEnter={onEditRetryIntent}
                    onFocus={onEditRetryIntent}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    {tActions("editRetry")}
                  </DropdownMenuItem>
                )}

                {hasAction("cancel_processing") && onCancelProcessing != null && (
                  <DropdownMenuItem onClick={onCancelProcessing} disabled={isCancelling}>
                    <CircleStop className="mr-2 h-4 w-4" />
                    {tActions("cancelProcessing")}
                  </DropdownMenuItem>
                )}

                {hasAction("retry") && onDelete != null && <DropdownMenuSeparator />}

                {onDelete != null && (
                  <DropdownMenuItem onClick={onDelete} className="text-danger focus:text-danger">
                    <Trash2 className="mr-2 h-4 w-4" />
                    {tCommon("delete")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
});
