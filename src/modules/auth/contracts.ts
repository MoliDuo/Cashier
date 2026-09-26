export interface AuthenticatedPrincipal {
  id: string;
  email: string | null;
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
