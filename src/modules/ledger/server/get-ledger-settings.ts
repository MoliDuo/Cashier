import { withLedgerAccess } from "../access";
import type { LedgerSettingsViewDto } from "@/modules/ledger/contracts";
import { countUncategorizedEntries } from "./categories";
import { listServiceCredentials } from "./service-credentials";

export async function getLedgerSettingsView(ledgerId: string): Promise<LedgerSettingsViewDto> {
  const [uncategorizedCount, credentials] = await Promise.all([
    countUncategorizedEntries(ledgerId),
    listServiceCredentials(ledgerId),
  ]);
  return { uncategorizedCount, credentials };
}

/**
 * Returns uncategorizedCount and credentials only. Categories are read
 * separately through getEntryCategoriesAction so optimistic category edits
 * keep sharing one cache entry with the category mutations.
 */
export const getLedgerSettingsAction = withLedgerAccess(getLedgerSettingsView);
