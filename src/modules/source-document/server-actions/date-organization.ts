"use server";

import { applyDateOrganization, dismissDateOrganization } from "../server/date-organization";
import {
  applyDateOrganizationInputSchema,
  dismissDateOrganizationInputSchema,
} from "@/modules/source-document/contract-schemas";
import { withLedgerAccess } from "@/modules/ledger/access";

export const applyDateOrganizationAction = withLedgerAccess(async (input: unknown) => {
  const validated = applyDateOrganizationInputSchema.parse(input);
  return applyDateOrganization(validated);
});

export const dismissDateOrganizationAction = withLedgerAccess(async (input: unknown) => {
  const validated = dismissDateOrganizationInputSchema.parse(input);
  return dismissDateOrganization(validated);
});
