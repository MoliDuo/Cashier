"use server";

import crypto from "node:crypto";
import { logger } from "@/lib/logger";
import { authenticateDevUser } from "@/modules/auth/server/authenticate-dev-user";
import { completeInteractiveSignIn } from "@/modules/auth/server/complete-interactive-sign-in";
import { startSession } from "@/modules/auth/server/current-session";

export type SignInActionResult = { ok: true } | { ok: false };

/** Local development only: `authenticateDevUser` returns null anywhere else. */
export async function devSignInAction(): Promise<SignInActionResult> {
  try {
    const email = authenticateDevUser();
    if (email == null) return { ok: false };
    await completeInteractiveSignIn();
    await startSession(email);
    return { ok: true };
  } catch (error) {
    logger.error(
      { error, correlationId: crypto.randomUUID(), errorCode: "SIGN_IN_FAILED" },
      "Dev sign-in failed"
    );
    return { ok: false };
  }
}
