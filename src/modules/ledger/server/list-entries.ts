import { withLedgerAccess } from "../access";
import { serverComposition } from "@/application/server-composition-root";
import { listLedgerEntries } from "../application/queries/list-ledger-entries";

/**
 * The ledger's entries. The query validates whatever it is handed, so this
 * wrapper only authorizes the ledger and supplies the read port — the session
 * query route and the server-side prefetch call it the same way.
 */
export const getLedgerEntriesAction = withLedgerAccess((ledgerId: string, params: unknown) =>
  listLedgerEntries(ledgerId, params, serverComposition.ledgerReads)
);
