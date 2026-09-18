"use server";

import { headers } from "next/headers";
import { resolveSupportedLocale } from "@/i18n/resolve-locale";
import { AppError, ConflictError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { normalizeEmail } from "@/lib/utils/email";
import { parseSetupInput } from "../contract-schemas";
import { createInitialAccount } from "../application/create-initial-account";
import { serverComposition } from "@/application/server-composition-root";

export type SetupErrorCode =
  | "already_done"
  | "wrong_code"
  | "code_expired"
  | "code_locked_out"
  | "invalid_email"
  | "weak_password"
  | "invalid_books"
  | "unexpected";

export type SetupActionResult =
  { ok: true; ledgerId: string } | { ok: false; code: SetupErrorCode };

/** `PASSWORD_TOO_SHORT` and `PASSWORD_REQUIREMENTS_NOT_MET` are the policy's own codes. */
function isPasswordPolicyError(error: AppError): boolean {
  return error.code.startsWith("password_");
}

/**
 * The only unauthenticated write in the app. The setup code is what stands in
 * for a session: it is printed to the server's logs while the database is empty,
 * so only the operator who can read those logs can claim the account.
 */
export async function completeSetupAction(input: unknown): Promise<SetupActionResult> {
  try {
    if (!(await serverComposition.setup.isPending())) return { ok: false, code: "already_done" };
    const parsed = parseSetupInput(input);
    const verdict = await serverComposition.setup.verifyCode(parsed.setupCode);
    if (verdict !== "accepted") {
      // Logged without the attempted value: the point is to show a lockout is
      // happening, not to record what was guessed.
      logger.warn({ verdict }, "First-run setup rejected: the setup code was not accepted");
      if (verdict === "expired") return { ok: false, code: "code_expired" };
      if (verdict === "locked_out") return { ok: false, code: "code_locked_out" };
      return { ok: false, code: "wrong_code" };
    }
    const requestHeaders = await headers();
    const locale = resolveSupportedLocale({
      explicitLocale: parsed.locale,
      acceptLanguage: requestHeaders.get("accept-language"),
    });
    const result = await createInitialAccount(
      {
        bookNames: parsed.books,
        defaultBookName: parsed.defaultBook,
        email: normalizeEmail(parsed.email),
        password: parsed.password,
        locale,
      },
      serverComposition.setup
    );
    logger.info(
      { ledgerSubject: result.ledgerId },
      "First-run setup completed; the account and its books were created"
    );
    return { ok: true, ledgerId: result.ledgerId };
  } catch (error) {
    if (error instanceof ConflictError) return { ok: false, code: "already_done" };
    // The password policy reports its own `AppError` codes; without this the
    // wizard would answer "weak password" with a generic failure.
    if (error instanceof AppError && isPasswordPolicyError(error)) {
      return { ok: false, code: "weak_password" };
    }
    if (error instanceof ValidationError) {
      const fields = (error.details?.issues as { path?: unknown[] }[] | undefined)?.map((issue) =>
        String(issue.path?.[0] ?? "")
      );
      if (fields?.includes("email")) return { ok: false, code: "invalid_email" };
      if (fields?.includes("password")) return { ok: false, code: "weak_password" };
      if (fields?.some((field) => field === "books" || field === "defaultBook")) {
        return { ok: false, code: "invalid_books" };
      }
      return { ok: false, code: "unexpected" };
    }
    logger.error({ error }, "First-run setup failed");
    return { ok: false, code: "unexpected" };
  }
}
