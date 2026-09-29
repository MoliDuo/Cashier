"use client";
import type { ReactNode } from "react";

interface NewRecordFooterProps {
  /** The book picker, when the form sits in the new-record dialog. */
  start?: ReactNode;
  children: ReactNode;
}

/**
 * The bottom row of a new-record form: the book on the left, the submit on the
 * right. In the sheet it stays pinned to the bottom of the scrolling body, so
 * the submit is never scrolled away; a form used elsewhere keeps it in flow.
 */
export function NewRecordFooter({ start, children }: NewRecordFooterProps) {
  if (start == null) return <div className="flex items-center justify-end gap-2">{children}</div>;
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-2 border-t border-border bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:-mx-6 sm:px-6 sm:pb-4">
      <div className="min-w-0 flex-1">{start}</div>
      {children}
    </div>
  );
}
