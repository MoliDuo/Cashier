import type { ServiceCredentialPort } from "@/application/contracts";
import type { CreatedServiceCredentialDto } from "@/modules/ledger/contracts";

export async function createServiceCredential(
  ledgerId: string,
  input: { name: string; bookId: string },
  credentials: Pick<ServiceCredentialPort, "create">
): Promise<CreatedServiceCredentialDto> {
  const credential = await credentials.create(ledgerId, input.name, input.bookId);
  return {
    id: credential.id,
    bookId: credential.bookId,
    token: credential.token,
    tokenPrefix: credential.tokenPrefix,
    tokenSuffix: credential.tokenSuffix,
    ledgerId: credential.ledgerId,
    name: credential.name,
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt,
    deletedAt: null,
  };
}
