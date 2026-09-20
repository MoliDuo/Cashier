import type { ServiceCredentialPort, ServiceCredentialContract } from "@/application/contracts";
import type { ServiceCredentialDto } from "@/modules/ledger/contracts";

/**
 * The one translation from a stored key to what the browser may see. It names
 * every field instead of spreading the stored row: a token, a hash or anything
 * a later migration adds to the row must be published on purpose.
 */
export function toServiceCredentialDto(
  credential: ServiceCredentialContract
): ServiceCredentialDto {
  return {
    id: credential.id,
    bookId: credential.bookId,
    tokenPrefix: credential.tokenPrefix,
    tokenSuffix: credential.tokenSuffix,
    ledgerId: credential.ledgerId,
    name: credential.name,
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt,
    deletedAt: null,
  };
}

export async function listServiceCredentials(
  ledgerId: string,
  credentials: Pick<ServiceCredentialPort, "list">
): Promise<ServiceCredentialDto[]> {
  return (await credentials.list(ledgerId)).map(toServiceCredentialDto);
}
