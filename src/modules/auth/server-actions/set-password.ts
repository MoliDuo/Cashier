"use server";

import { requireRecentAuth } from "@/modules/auth/server/session-guards";
import { parsePasswordMutationInput } from "@/modules/auth/contract-schemas";
import { setPassword } from "@/modules/auth/server/set-password";
import { logError } from "@/lib/error-handlers";
import type { PasswordMutationActionResult } from "@/modules/auth/contracts";
import { toPasswordMutationActionErrorCode } from "./password-action-result";

export async function setPasswordAction(input: unknown): Promise<PasswordMutationActionResult> {
  try {
    const userId = await requireRecentAuth();
    const parsed = parsePasswordMutationInput(input);
    const passwordUpdatedAt = await setPassword({
      userId,
      newPassword: parsed.newPassword,
      confirmPassword: parsed.confirmPassword,
    });
    return { ok: true, passwordUpdatedAt: passwordUpdatedAt.toISOString() };
  } catch (error) {
    const code = toPasswordMutationActionErrorCode(error);
    if (code === "unexpected") logError("setPasswordAction", error);
    return { ok: false, code };
  }
}
