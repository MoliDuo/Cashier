import type { SessionUser } from "@/modules/auth/server/sessions";

export const TEST_SESSION_USER_ID = "00000000-0000-0000-0000-000000000000";

/** A session as `getCurrentSession` returns it, signed in just now. */
export function testSession(
  userId = TEST_SESSION_USER_ID,
  overrides: Partial<SessionUser> = {}
): SessionUser {
  const now = new Date();
  return {
    sessionId: "00000000-0000-0000-0000-00000000000a",
    userId,
    email: "test@example.com",
    authenticatedAt: now,
    expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}
