import type { ServiceCredentialPort } from "@/application/contracts";
import type { ServiceCredentialDto } from "@/modules/ledger/contracts";
import { ConflictError } from "@/lib/errors";

/** Rebinds one key to another book; its store of uploads follows immediately. */
export async function setServiceCredentialBook(
  ledgerId: string,
  credentialId: string,
  bookId: string,
  credentials: Pick<ServiceCredentialPort, "setBook">
): Promise<ServiceCredentialDto> {
  const updated = await credentials.setBook(ledgerId, credentialId, bookId);
  if (updated == null) throw new ConflictError("Service credential is not available");
  return {
    id: updated.id,
    bookId: updated.bookId,
    tokenPrefix: updated.tokenPrefix,
    tokenSuffix: updated.tokenSuffix,
    ledgerId: updated.ledgerId,
    name: updated.name,
    createdAt: updated.createdAt,
    lastUsedAt: updated.lastUsedAt,
    deletedAt: null,
  };
}
