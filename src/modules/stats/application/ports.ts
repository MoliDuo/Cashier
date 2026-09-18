import type { GetBookTotalsInput, GetEnhancedStatsInput } from "../contract-schemas";
import type { BookTotalsDto, EnhancedStatsDto } from "../contracts";

export interface StatsReadPort {
  queryEnhanced(input: GetEnhancedStatsInput): Promise<EnhancedStatsDto>;
  queryBookTotals(input: GetBookTotalsInput): Promise<BookTotalsDto>;
}
