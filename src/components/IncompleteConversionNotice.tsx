import { cn } from "@/lib/utils";
import { textRoleClassName } from "@/components/typography";
import { commonCopy } from "@/copy/common";

/**
 * Says that some records have no rate for their day, so the main-currency
 * total leaves them out. One notice for every surface that shows such a total,
 * drawn in the warning token rather than a palette colour of its own.
 */
export function IncompleteConversionNotice({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        textRoleClassName(
          "body",
          "rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-warning"
        ),
        className
      )}
    >
      {commonCopy.incompleteAccountingProjection}
    </div>
  );
}
