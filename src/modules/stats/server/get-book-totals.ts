import { requireLedgerAccess } from "@/modules/ledger/access";
import { getBookTotalsQuery } from "../application/queries/get-book-totals";
import { parseGetBookTotalsInput, type GetBookTotalsInput } from "../contract-schemas";
import type { BookTotalsDto } from "../contracts";
import { serverComposition } from "@/application/server-composition-root";

export async function getBookTotals(input: GetBookTotalsInput): Promise<BookTotalsDto> {
  const validatedInput = parseGetBookTotalsInput(input);
  await requireLedgerAccess(validatedInput.ledgerId);
  return getBookTotalsQuery(validatedInput, serverComposition.stats);
}
