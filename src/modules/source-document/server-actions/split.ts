"use server";

import { splitSourceDocumentAtomically } from "../server/split";
import type {
  SplitSourceDocumentInput,
  VersionedCommandResult,
  SplitSourceDocumentResultDto,
} from "@/modules/source-document/contracts";
import { splitSourceDocumentInputSchema } from "@/modules/source-document/contract-schemas";
import { withSourceDocumentLedgerAccess } from "./access";

export const splitSourceDocumentAction = withSourceDocumentLedgerAccess(
  async (
    { ledgerId },
    input: SplitSourceDocumentInput
  ): Promise<VersionedCommandResult<SplitSourceDocumentResultDto>> => {
    const validated = splitSourceDocumentInputSchema.parse(input);
    return splitSourceDocumentAtomically({ ledgerId, ...validated });
  }
);
