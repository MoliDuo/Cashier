"use server";
import { withLedgerAccess } from "../access";
import type { CreatedServiceCredentialDto, ServiceCredentialDto } from "@/modules/ledger/contracts";
import {
  parseCreateServiceCredentialInput,
  parseServiceCredentialId,
  type CreateServiceCredentialInput,
} from "@/modules/ledger/contract-schemas";
import { createServiceCredential } from "@/modules/ledger/application/use-cases/create-service-credential";
import { deleteServiceCredential } from "@/modules/ledger/application/use-cases/delete-service-credential";
import { listServiceCredentials } from "@/modules/ledger/application/queries/list-service-credentials";
import { serverComposition } from "@/application/server-composition-root";
import { requireAuth } from "@/lib/auth-actions";

/** @publicContract Retained server-action boundary for credential management. */
export const getServiceCredentialsAction = withLedgerAccess(
  async (ledgerId: string): Promise<ServiceCredentialDto[]> =>
    listServiceCredentials(ledgerId, serverComposition.serviceCredentials)
);

export const createServiceCredentialAction = withLedgerAccess(
  async (
    ledgerId: string,
    data: CreateServiceCredentialInput
  ): Promise<CreatedServiceCredentialDto> => {
    const validated = parseCreateServiceCredentialInput(data);
    return createServiceCredential(
      ledgerId,
      validated,
      serverComposition.serviceCredentials,
      await requireAuth()
    );
  }
);

export const deleteServiceCredentialAction = withLedgerAccess(
  async (ledgerId: string, credentialId: string): Promise<void> => {
    const validatedCredentialId = parseServiceCredentialId(credentialId);
    return deleteServiceCredential(
      ledgerId,
      validatedCredentialId,
      serverComposition.serviceCredentials
    );
  }
);
