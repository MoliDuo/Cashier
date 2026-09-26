export const AUTH_ERROR_CODES = {
  REGISTRATION_DISABLED: "registration_disabled",
  OTP_INVALID: "otp_invalid",
  OTP_EXPIRED: "otp_expired",
  OTP_LOCKED: "otp_locked",
  OTP_RATE_LIMITED: "otp_rate_limited",
  EMAIL_ALREADY_EXISTS: "email_already_exists",
  OTP_REQUIRED: "otp_required",
  OTP_INVALID_FOR_ACTION: "otp_invalid_for_action",
  INVALID_CREDENTIALS: "invalid_credentials",
  AUTH_RATE_LIMIT_UNAVAILABLE: "auth_rate_limit_unavailable",
  PASSKEY_RATE_LIMITED: "passkey_rate_limited",
  REAUTHENTICATION_REQUIRED: "REAUTHENTICATION_REQUIRED",
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

export class AuthSignInError extends Error {
  override readonly name = "AuthSignInError";

  constructor(public readonly code: AuthErrorCode) {
    super(code);
  }
}
