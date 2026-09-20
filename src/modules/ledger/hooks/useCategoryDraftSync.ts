"use client";

import { useMemo, useState } from "react";
import type { EntryCategory } from "@/modules/ledger/contracts";
import { categoryDraftsEqual, toCategoryDraft, type CategoryDraft } from "./category-draft-model";

interface UseCategoryDraftSyncOptions {
  categories: EntryCategory[];
  managing: boolean;
  serverDraft: CategoryDraft[];
  setServerDraft: (drafts: CategoryDraft[]) => void;
  setDraftOrder: (drafts: CategoryDraft[]) => void;
  hasCategoryDraft: boolean;
}

/**
 * Reconciles incoming server categories against the in-progress draft while
 * `managing` is active: applies server changes straight through when the
 * draft has no local edits, or flags a conflict when it does.
 *
 * There is one conflict, not two: a draft that has moved on since the saved
 * revision is the same condition whether the server answered a save with
 * `CONFLICT` or the categories arrived under an edited draft.
 */
export function useCategoryDraftSync({
  categories,
  managing,
  serverDraft,
  setServerDraft,
  setDraftOrder,
  hasCategoryDraft,
}: UseCategoryDraftSyncOptions) {
  const [revisionConflict, setRevisionConflict] = useState(false);
  const incomingDraft = useMemo(() => categories.map(toCategoryDraft), [categories]);

  if (managing && !categoryDraftsEqual(serverDraft, incomingDraft)) {
    setServerDraft(incomingDraft);
    if (hasCategoryDraft) {
      setRevisionConflict(true);
    } else {
      setDraftOrder(incomingDraft);
      setRevisionConflict(false);
    }
  }

  const resetSyncState = () => {
    setRevisionConflict(false);
  };

  return {
    incomingDraft,
    revisionConflict,
    setRevisionConflict,
    resetSyncState,
  };
}
