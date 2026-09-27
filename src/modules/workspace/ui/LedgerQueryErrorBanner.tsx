"use client";

import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { ledgerQueryErrorCopy } from "@/copy/app";

interface LedgerQueryErrorBannerProps {
  onRetry: () => void;
  empty?: boolean;
}

export function LedgerQueryErrorBanner({ onRetry, empty = false }: LedgerQueryErrorBannerProps) {
  const description = empty
    ? ledgerQueryErrorCopy.emptyDescription
    : ledgerQueryErrorCopy.description;

  return (
    <div
      role="alert"
      data-testid="ledger-query-error-banner"
      className={
        empty
          ? textRoleClassName(
              "body",
              "my-8 flex flex-col items-center gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-10 text-center"
            )
          : textRoleClassName(
              "meta",
              "mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-text"
            )
      }
    >
      <span aria-hidden className="size-3 rounded-full bg-danger" />
      <span>{description}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={textRoleClassName(
          "meta",
          empty ? "h-8 px-3 text-text" : "ml-auto h-7 px-2 text-text"
        )}
        onClick={onRetry}
      >
        {ledgerQueryErrorCopy.retry}
      </Button>
    </div>
  );
}
