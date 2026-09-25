"use server";
import { withLedgerAccess } from "@/modules/ledger/access";
import { logError } from "@/lib/error-handlers";
import type { UpdateLedgerActionResult } from "@/modules/ledger/contracts";
import { parseUpdateLedgerInput, type UpdateLedgerInput } from "@/modules/ledger/contract-schemas";
import { updateLedgerSettings } from "../server/settings";
import { toUpdateLedgerActionErrorCode } from "./update-error";

export const updateLedgerSettingsAction = withLedgerAccess(
  async (ledgerId: string, data: UpdateLedgerInput): Promise<UpdateLedgerActionResult> => {
    try {
      const validated = parseUpdateLedgerInput(data);
      return {
        ok: true,
        ledger: await updateLedgerSettings(ledgerId, validated),
      };
    } catch (error) {
      const code = toUpdateLedgerActionErrorCode(error);
      // This settings action intentionally returns a recovery-code result so
      // callers can keep drafts on known conflicts. Other simple commands
      // continue to throw their typed application errors at the boundary.
      if (code === "unexpected") logError("updateLedgerSettingsAction", error);
      return { ok: false, code };
    }
  }
);
