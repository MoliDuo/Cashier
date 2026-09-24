"use client";

import { createContext, useContext } from "react";
import type { CategoryReclassificationJob } from "@/modules/ledger/contracts";

export interface CategoryAssignmentContextValue {
  /** The ledger's most recent assignment run. */
  job: CategoryReclassificationJob | null;
  isActive: boolean;
  isReadError: boolean;
  refresh: () => Promise<unknown>;
  dismiss: () => void;
  registerSubmittedJob: (job: CategoryReclassificationJob) => void;
}

/**
 * The page's view of the ledger's assignment run. It lives in its own module on
 * purpose: the settings section and the details dialog read the run without
 * pulling in the provider — and with it the status band — ahead of the page.
 */
export const CategoryAssignmentContext = createContext<CategoryAssignmentContextValue | null>(null);

/**
 * The run as the page above the tabs sees it. Read it instead of starting a poll
 * of your own: one owner means one poll, one history of what this page watched,
 * and one completion notice, whichever tab happens to be mounted.
 */
export function useCategoryAssignment(): CategoryAssignmentContextValue {
  const value = useContext(CategoryAssignmentContext);
  if (value == null) {
    throw new Error("useCategoryAssignment must be used inside CategoryAssignmentProvider");
  }
  return value;
}
