import type { ServiceCredentialPort } from "@/application/contracts";
import type { CreatedServiceCredentialDto } from "@/modules/ledger/contracts";
import { toServiceCredentialDto } from "../queries/list-service-credentials";

export async function createServiceCredential(
  ledgerId: string,
  input: { name: string; bookId: string },
  credentials: Pick<ServiceCredentialPort, "create">
): Promise<CreatedServiceCredentialDto> {
  const credential = await credentials.create(ledgerId, input.name, input.bookId);
  // The plaintext token is shown once, here, and never reaches the browser's
  // view of the ledger's keys.
  return {
    ...toServiceCredentialDto(credential),
    token: credential.token,
  };
}
