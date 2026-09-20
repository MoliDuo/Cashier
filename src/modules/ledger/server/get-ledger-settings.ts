import { withLedgerAccess } from "../access";
import type { LedgerSettingsViewDto } from "@/modules/ledger/contracts";
import { getLedgerSettingsView } from "@/modules/ledger/application/queries/get-ledger-settings-view";
import { serverComposition } from "@/application/server-composition-root";

/**
 * Returns uncategorizedCount and credentials only. Categories are read
 * separately through getEntryCategoriesAction so optimistic category edits
 * keep sharing one cache entry with the category mutations.
 */
export const getLedgerSettingsAction = withLedgerAccess(
  async (ledgerId: string): Promise<LedgerSettingsViewDto> =>
    getLedgerSettingsView(ledgerId, {
      categories: serverComposition.categories,
      credentials: serverComposition.serviceCredentials,
    })
);
