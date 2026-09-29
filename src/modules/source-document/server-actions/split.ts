"use server";

import { splitSourceDocumentAtomically } from "../server/split";
import type {
  SplitSourceDocumentInput,
  SplitSourceDocumentResultDto,
} from "@/modules/source-document/contracts";
import { splitSourceDocumentInputSchema } from "@/modules/source-document/contract-schemas";
import { withLedgerAccess } from "@/modules/ledger/access";

export const splitSourceDocumentAction = withLedgerAccess(
  async (input: SplitSourceDocumentInput): Promise<SplitSourceDocumentResultDto> => {
    const validated = splitSourceDocumentInputSchema.parse(input);
    return splitSourceDocumentAtomically(validated);
  }
);
