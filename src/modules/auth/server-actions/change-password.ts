"use server";

import { withAuth } from "@/modules/auth/server/session-guards";
import { parsePasswordMutationInput } from "@/modules/auth/contract-schemas";
import { changePassword } from "@/modules/auth/server/change-password";
import { logError } from "@/lib/error-handlers";
import type { PasswordMutationActionResult } from "@/modules/auth/contracts";
import { toPasswordMutationActionErrorCode } from "./password-action-result";

export const changePasswordAction = withAuth(
  async (userId: string, input: unknown): Promise<PasswordMutationActionResult> => {
    try {
      const parsed = parsePasswordMutationInput(input);
      const passwordUpdatedAt = await changePassword({
        userId,
        currentPassword: parsed.currentPassword ?? "",
        newPassword: parsed.newPassword,
        confirmPassword: parsed.confirmPassword,
      });
      return { ok: true, passwordUpdatedAt: passwordUpdatedAt.toISOString() };
    } catch (error) {
      const code = toPasswordMutationActionErrorCode(error);
      if (code === "unexpected") logError("changePasswordAction", error);
      return { ok: false, code };
    }
  }
);
