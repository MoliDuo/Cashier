/**
 * Normalize email address for consistent storage and comparison.
 * - Converts to lowercase
 * - Trims whitespace
 *
 * Note: This does NOT validate the email format, only normalizes it.
 * Use schema validation (Zod) for format validation.
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}
