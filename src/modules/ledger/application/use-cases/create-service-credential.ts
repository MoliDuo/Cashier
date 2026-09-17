import type { ServiceCredentialPort } from "@/application/contracts";
import type { CreatedServiceCredentialDto } from "@/modules/ledger/contracts";

export async function createServiceCredential(
  ledgerId: string,
  input: { name: string },
  credentials: Pick<ServiceCredentialPort, "create">,
  userId?: string
): Promise<CreatedServiceCredentialDto> {
  const credential = await credentials.create(ledgerId, input.name, userId);
  return {
    id: credential.id,
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
