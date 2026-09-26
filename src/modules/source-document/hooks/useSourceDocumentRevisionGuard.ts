"use client";

import { useEffect, useRef } from "react";

interface UseSourceDocumentRevisionGuardOptions {
  hasPendingChanges: boolean;
  isEditing: boolean;
  version: number | undefined;
  /** The version a restored draft was made against, which it keeps as its base. */
  restoredBaseVersion?: number | null;
}

/**
 * Tracks the document version a draft started from. A newer server snapshot
 * never rebases local edits implicitly.
 */
export function useSourceDocumentRevisionGuard({
  hasPendingChanges,
  isEditing,
  version,
  restoredBaseVersion = null,
}: UseSourceDocumentRevisionGuardOptions) {
  const baseVersionRef = useRef<number | null>(null);

  useEffect(() => {
    if (isEditing || hasPendingChanges) {
      baseVersionRef.current ??= restoredBaseVersion ?? version ?? null;
    } else {
      baseVersionRef.current = null;
    }
  }, [hasPendingChanges, isEditing, restoredBaseVersion, version]);

  // A restored draft's base is known before the effect records it.
  const baseVersion = baseVersionRef.current ?? restoredBaseVersion;
  const hasVersionConflict =
    hasPendingChanges && baseVersion != null && version != null && baseVersion !== version;

  return { baseVersionRef, hasVersionConflict };
}
