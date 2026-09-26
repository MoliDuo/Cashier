import { postLedgerQuery } from "@/lib/queries/post-ledger-query";
import type { GetEnhancedStatsInput } from "./contract-schemas";
import type { EnhancedStatsDto } from "./contracts";

/** The 统计 read, served by `/api/ledger-queries`. */
export const fetchEnhancedStats = (input: GetEnhancedStatsInput) =>
  postLedgerQuery<EnhancedStatsDto>("stats", [input]);
