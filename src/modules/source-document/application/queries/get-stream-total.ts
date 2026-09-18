import type { SourceDocumentReadPort } from "../ports";
import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";
import type { StreamTotalDto } from "../../contracts";
import { normalizeSearchTerm } from "@/lib/search";

export interface GetStreamTotalInput {
  bookId?: string;
  startDate?: string | null;
  endDate?: string | null;
  minAmount?: string;
  maxAmount?: string;
  statuses?: readonly SourceDocumentProcessingStatus[];
  search?: string;
}

export async function getStreamTotal(
  ledgerId: string,
  input: GetStreamTotalInput = {},
  documents: Pick<SourceDocumentReadPort, "calculateCompletedTotal">
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
  return documents.calculateCompletedTotal({
    ledgerId,
    ...filters,
    ...(search != null ? { search } : {}),
  });
}
