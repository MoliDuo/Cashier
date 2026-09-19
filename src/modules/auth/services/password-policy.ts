import { AppError } from "@/lib/errors";
import { AUTH_ERROR_CODES } from "@/modules/auth/errors";
import {
  getPasswordRuleViolation,
  PASSWORD_RULE_MESSAGES,
  type PasswordRuleViolation,
} from "@/modules/auth/password-rules";

/**
 * The code each rule reports. The messages and codes are the API's contract, so
 * they stay exactly as they were; only the rule itself moved to the shared
 * module, where the wizard can read the same verdict.
 */
const VIOLATION_CODES: Record<PasswordRuleViolation, string> = {
  length: AUTH_ERROR_CODES.PASSWORD_TOO_SHORT,
  bytes: AUTH_ERROR_CODES.PASSWORD_REQUIREMENTS_NOT_MET,
  composition: AUTH_ERROR_CODES.PASSWORD_REQUIREMENTS_NOT_MET,
};

export function validatePassword(password: string): void {
  const violation = getPasswordRuleViolation(password);
  if (violation == null) return;
  throw new AppError(PASSWORD_RULE_MESSAGES[violation], VIOLATION_CODES[violation], 400);
}
