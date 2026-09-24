"use server";
import { withLedgerAccess } from "../access";
import type { CreatedServiceCredentialDto, ServiceCredentialDto } from "@/modules/ledger/contracts";
import {
  parseCreateServiceCredentialInput,
  parseServiceCredentialId,
  parseUpdateServiceCredentialInput,
  type CreateServiceCredentialInput,
  type UpdateServiceCredentialInput,
} from "@/modules/ledger/contract-schemas";
import {
  createServiceCredential,
  revokeServiceCredential,
  setServiceCredentialBook,
} from "../server/service-credentials";

export const createServiceCredentialAction = withLedgerAccess(
  async (
    ledgerId: string,
    data: CreateServiceCredentialInput
  ): Promise<CreatedServiceCredentialDto> =>
    createServiceCredential(ledgerId, parseCreateServiceCredentialInput(data))
);

/** Rebinds one key to another book; its store of uploads follows immediately. */
export const updateServiceCredentialAction = withLedgerAccess(
  async (
    ledgerId: string,
    credentialId: string,
    data: UpdateServiceCredentialInput
  ): Promise<ServiceCredentialDto> => {
    const validatedCredentialId = parseServiceCredentialId(credentialId);
    const validated = parseUpdateServiceCredentialInput(data);
    return setServiceCredentialBook(ledgerId, validatedCredentialId, validated.bookId);
  }
);

export const deleteServiceCredentialAction = withLedgerAccess(
  async (ledgerId: string, credentialId: string): Promise<void> =>
    revokeServiceCredential(ledgerId, parseServiceCredentialId(credentialId))
);
