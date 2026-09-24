"use server";

import { applyDateOrganization, dismissDateOrganization } from "../server/date-organization";
import {
  applyDateOrganizationInputSchema,
  dismissDateOrganizationInputSchema,
} from "@/modules/source-document/contract-schemas";
import { withSourceDocumentLedgerAccess } from "./access";

export const applyDateOrganizationAction = withSourceDocumentLedgerAccess(
  async ({ ledgerId }, input: unknown) => {
    const validated = applyDateOrganizationInputSchema.parse(input);
    return applyDateOrganization({
      ledgerId,
      ...validated,
    });
  }
);

export const dismissDateOrganizationAction = withSourceDocumentLedgerAccess(
  async ({ ledgerId }, input: unknown) => {
    const validated = dismissDateOrganizationInputSchema.parse(input);
    return dismissDateOrganization({
      ledgerId,
      ...validated,
    });
  }
);
