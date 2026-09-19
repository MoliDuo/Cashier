/**
 * The password rules, in one place because two callers need them: the server
 * policy that guards every write, and the first-run form that would rather say
 * why a password cannot work before spending a round trip on it. They used to
 * be written out twice and had drifted apart.
 *
 * The module is deliberately free of dependencies — no bcrypt, no database, no
 * environment, no error class — because a browser form imports it. That is also
 * why it is a plain function rather than a thrown error: the caller decides how
 * to report the verdict.
 */

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
/**
 * bcrypt only hashes the first 72 bytes of its input, so a longer password would
 * verify against a prefix of itself. Rejecting it keeps the stored hash and the
 * typed password the same string.
 */
const MAX_PASSWORD_BYTES = 72;
const HAS_LETTER_AND_NUMBER = /^(?=.*[A-Za-z])(?=.*\d).+$/;

/** Why a password cannot be accepted; the order here is the order of the checks. */
export type PasswordRuleViolation = "length" | "bytes" | "composition";

/**
 * What each rule says when it refuses, phrased once for the API and the form.
 * It is not translated: the wizard shows its own localized copy, and these are
 * what the server logs and the API's error messages carry.
 */
export const PASSWORD_RULE_MESSAGES: Record<PasswordRuleViolation, string> = {
  length: "Password must be between 8 and 128 characters",
  bytes: "Password must be at most 72 UTF-8 bytes",
  composition: "Password must contain at least one letter and one number",
};

/**
 * The first rule the password breaks, or null when it satisfies all of them.
 * The string is measured as typed: it is not trimmed, truncated, or normalized,
 * because the server hashes exactly these characters.
 */
export function getPasswordRuleViolation(password: string): PasswordRuleViolation | null {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return "length";
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return "bytes";
  if (!HAS_LETTER_AND_NUMBER.test(password)) return "composition";
  return null;
}
