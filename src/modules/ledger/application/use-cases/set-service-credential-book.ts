import type { ServiceCredentialPort } from "@/application/contracts";
import type { ServiceCredentialDto } from "@/modules/ledger/contracts";
import { toServiceCredentialDto } from "../queries/list-service-credentials";

/** Rebinds one key to another book; its store of uploads follows immediately. */
export async function setServiceCredentialBook(
  ledgerId: string,
  credentialId: string,
  bookId: string,
  credentials: Pick<ServiceCredentialPort, "setBook">
): Promise<ServiceCredentialDto> {
  const updated = await credentials.setBook(ledgerId, credentialId, bookId);
  return toServiceCredentialDto(updated);
}
