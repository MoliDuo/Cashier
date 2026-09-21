export interface AuthenticatedPrincipal {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  authVersion: number;
  /**
   * OTP-only: the verified token is claimed but not yet consumed. The
   * interactive sign-in orchestrator consumes it only after cross-module
   * completion (shared ledger validation) succeeds, and releases it on failure.
   */
}

export type PasswordMutationActionErrorCode =
  | "password_too_short"
  | "password_requirements_not_met"
  | "password_mismatch"
  | "current_password_wrong"
  | "password_rate_limited"
  | "reauth_required"
  | "validation_failed"
  | "conflict"
  | "unexpected";

export type PasswordMutationActionResult =
  { ok: true; passwordUpdatedAt: string } | { ok: false; code: PasswordMutationActionErrorCode };
