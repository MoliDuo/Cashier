import { withAuth } from "@/lib/auth-actions";
import { serverComposition } from "@/application/server-composition-root";
import { getLedger } from "@/modules/ledger/application/queries/get-ledger";
import { parseLedgerId } from "@/modules/ledger/contract-schemas";

/**
 * Read through the session query route rather than the action queue, which is
 * why it lives here rather than beside the ledger writers. A ledger the caller
 * cannot see resolves to null instead of throwing.
 */
export const getLedgerAction = withAuth(async (userId: string, id: string) =>
  getLedger({ ledgerId: parseLedgerId(id), userId }, serverComposition.ledgers)
);
