import type { GetBookTotalsInput } from "@/modules/stats/contract-schemas";
import type { BookTotalsDto } from "@/modules/stats/contracts";
import type { StatsReadPort } from "../ports";

export function getBookTotalsQuery(
  input: GetBookTotalsInput,
  stats: Pick<StatsReadPort, "queryBookTotals">
): Promise<BookTotalsDto> {
  return stats.queryBookTotals(input);
}
