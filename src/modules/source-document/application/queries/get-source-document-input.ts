import { NotFoundError } from "@/lib/errors";
import type { SourceDocumentInputDto } from "../../contracts";
import type { SourceDocumentReadPort } from "../ports";

export async function getSourceDocumentInputQuery(
  ledgerId: string,
  sourceDocumentId: string,
  documents: Pick<SourceDocumentReadPort, "getInput">
): Promise<SourceDocumentInputDto> {
  const document = await documents.getInput(ledgerId, sourceDocumentId);

  if (document == null) {
    throw new NotFoundError("Source document");
  }

  return document;
}
