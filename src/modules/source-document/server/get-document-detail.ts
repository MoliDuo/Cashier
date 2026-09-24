import type { SourceDocumentDetailDto } from "@/modules/source-document/contracts";
import { withLedgerAccess } from "@/modules/ledger/access";
import { sourceDocumentIdSchema } from "../contract-schemas";
import { ValidationError } from "@/lib/errors";
import { serverComposition } from "@/application/server-composition-root";

/**
 * Fetch the complete document detail used by the editor.
 */
export const getSourceDocumentDetailAction = withLedgerAccess(
  async (ledgerId: string, id: string): Promise<SourceDocumentDetailDto | null> => {
    const parsed = sourceDocumentIdSchema.safeParse(id);
    if (!parsed.success) {
      throw new ValidationError("Validation failed", { issues: parsed.error.issues });
    }
    return serverComposition.sourceDocumentReads.get(ledgerId, parsed.data);
  }
);
