import type { ServiceCredentialPort } from "@/application/contracts";
import type { ServiceCredentialDto } from "@/modules/ledger/contracts";

export async function listServiceCredentials(
  ledgerId: string,
  credentials: Pick<ServiceCredentialPort, "list">
): Promise<ServiceCredentialDto[]> {
  return (await credentials.list(ledgerId)).map((credential) => ({
    id: credential.id,
    bookId: credential.bookId,
    tokenPrefix: credential.tokenPrefix,
    tokenSuffix: credential.tokenSuffix,
    ledgerId: credential.ledgerId,
    name: credential.name,
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt,
    deletedAt: null,
  }));
}
