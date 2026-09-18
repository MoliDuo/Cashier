import { withLedgerAccess } from "../access";
import { serverComposition } from "@/application/server-composition-root";
import { listLedgerEntries } from "../application/queries/list-ledger-entries";
import { parseListLedgerEntriesInput } from "../contract-schemas";

export const getLedgerEntriesAction = withLedgerAccess(
  (ledgerId: string, params: Parameters<typeof listLedgerEntries>[1]) => {
    const validated = parseListLedgerEntriesInput(params);
    return listLedgerEntries(ledgerId, validated, serverComposition.ledgerReads);
  }
);
