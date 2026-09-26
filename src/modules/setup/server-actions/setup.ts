"use server";

import { ConflictError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { normalizeEmail } from "@/lib/utils/email";
import { parseSetupInput } from "../contract-schemas";
import { createInitialAccount, isSetupPending } from "../server/initial-account";
import { verifySetupCode } from "../server/setup-code";

export type SetupErrorCode =
  | "already_done"
  | "wrong_code"
  | "code_expired"
  | "code_locked_out"
  | "invalid_email"
  | "invalid_books"
  | "unexpected";

export type SetupActionResult =
  { ok: true; ledgerId: string } | { ok: false; code: SetupErrorCode };

/**
 * The only unauthenticated write in the app. The setup code is what stands in
 * for a session: it is printed to the server's logs while the database is empty,
 * so only the operator who can read those logs can claim the account.
 */
export async function completeSetupAction(input: unknown): Promise<SetupActionResult> {
  try {
    if (!(await isSetupPending())) return { ok: false, code: "already_done" };
    const parsed = parseSetupInput(input);
    const verdict = await verifySetupCode(parsed.setupCode);
    if (verdict !== "accepted") {
      // Logged without the attempted value: the point is to show a lockout is
      // happening, not to record what was guessed.
      logger.warn({ verdict }, "First-run setup rejected: the setup code was not accepted");
      if (verdict === "expired") return { ok: false, code: "code_expired" };
      if (verdict === "locked_out") return { ok: false, code: "code_locked_out" };
      return { ok: false, code: "wrong_code" };
    }
    const result = await createInitialAccount({
      bookNames: parsed.books,
      email: normalizeEmail(parsed.email),
    });
    logger.info(
      { ledgerSubject: result.ledgerId },
      "First-run setup completed; the account and its books were created"
    );
    return { ok: true, ledgerId: result.ledgerId };
  } catch (error) {
    if (error instanceof ConflictError) return { ok: false, code: "already_done" };
    if (error instanceof ValidationError) {
      const fields = (error.details?.issues as { path?: unknown[] }[] | undefined)?.map((issue) =>
        String(issue.path?.[0] ?? "")
      );
      // The setup code is the gate: a request that did not carry a plausible
      // one is a wrong code, whether it was absent, blank, or the wrong shape.
      if (fields?.includes("setupCode")) return { ok: false, code: "wrong_code" };
      if (fields?.includes("email")) return { ok: false, code: "invalid_email" };
      if (fields?.includes("books")) return { ok: false, code: "invalid_books" };
      return { ok: false, code: "unexpected" };
    }
    logger.error({ error }, "First-run setup failed");
    return { ok: false, code: "unexpected" };
  }
}
