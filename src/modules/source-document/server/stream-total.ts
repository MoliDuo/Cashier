import "server-only";
import { calculateCompletedSourceDocumentTotal } from "./reads/filters";
import type { GetStreamTotalInput, StreamTotalDto } from "../contracts";
import { normalizeSearchTerm } from "@/lib/search";

export async function getStreamTotal(
  ledgerId: string,
  input: GetStreamTotalInput = {}
): Promise<StreamTotalDto> {
  if (
    input.statuses != null &&
    input.statuses.length > 0 &&
    !input.statuses.includes("completed")
  ) {
    return { total: "0", unconvertedCount: 0 };
  }

  const search = normalizeSearchTerm(input.search);
  const filters = { ...input };
  delete filters.search;
  return calculateCompletedSourceDocumentTotal({
    ledgerId,
    ...filters,
    ...(search != null ? { search } : {}),
  });
}
