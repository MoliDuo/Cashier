import { withLedgerAccess } from "../access";
import { serverComposition } from "@/application/server-composition-root";
import { listEntryCategories } from "@/modules/ledger/application/queries/list-entry-categories";

/** Read through the session query route rather than the action queue. */
export const getEntryCategoriesAction = withLedgerAccess((ledgerId: string) =>
  listEntryCategories(ledgerId, serverComposition.categories)
);
