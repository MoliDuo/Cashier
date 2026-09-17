import { withLedgerAccess } from "../access";
import { serverComposition } from "@/application/server-composition-root";
import { listLedgerEntries } from "../application/queries/list-ledger-entries";
import { isCoupleMember } from "@/lib/couple-config";
import { ValidationError } from "@/lib/errors";
import { parseListLedgerEntriesInput } from "../contract-schemas";

export const getLedgerEntriesAction = withLedgerAccess(
  (ledgerId: string, params: Parameters<typeof listLedgerEntries>[1]) => {
    const validated = parseListLedgerEntriesInput(params);
    if (validated.attributedUserId != null && !isCoupleMember(validated.attributedUserId))
      throw new ValidationError("Invalid member");
    return listLedgerEntries(ledgerId, params, serverComposition.ledgerReads);
  }
);
