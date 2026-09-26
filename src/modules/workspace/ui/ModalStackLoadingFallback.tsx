"use client";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useModalStackStore } from "@/lib/store/modal-stack";
import { commonCopy } from "@/copy/common";

function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded bg-surface2", className)} />;
}

export function ModalStackLoadingFallback() {
  const item = useModalStackStore((state) => state.stack.at(-1));
  const closeAll = useModalStackStore((state) => state.closeAll);
  if (item == null) return null;

  const isSourceDocument = item.type === "source-document";

  return (
    <Dialog open onOpenChange={(open) => !open && closeAll()}>
      <DialogContent
        variant="detail"
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          isSourceDocument ? "sm:max-w-2xl" : "sm:max-w-lg"
        )}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{commonCopy.loading}</DialogTitle>
        {isSourceDocument ? (
          <>
            <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-5">
              <Skeleton className="h-5 w-40" />
            </DialogHeader>
            <div className="flex-1 space-y-3 p-3 sm:p-4" role="status" aria-busy="true">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-3" />
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="space-y-2 rounded-lg border border-border p-3">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-28" />
              </div>
              {[1, 2].map((index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          </>
        ) : (
          <div className="space-y-4 p-6" role="status" aria-busy="true">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="flex justify-end gap-2 pt-4">
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-9 w-20" />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
