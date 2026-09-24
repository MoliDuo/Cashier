import { withLedgerAccess } from "../access";
import { listCategoriesWithCount } from "./categories";

/** Read through the session query route rather than the action queue. */
export const getEntryCategoriesAction = withLedgerAccess((ledgerId: string) =>
  listCategoriesWithCount(ledgerId)
);
