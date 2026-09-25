import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "@/lib/errors";

const {
  nextAuthMock,
  authenticateWithOTPMock,
  completeInteractiveSignInMock,
  getSessionUserMock,
  authenticateWithPasswordMock,
} = vi.hoisted(() => ({
  nextAuthMock: vi.fn(),
  authenticateWithOTPMock: vi.fn(),
  completeInteractiveSignInMock: vi.fn(),
  getSessionUserMock: vi.fn(),
  authenticateWithPasswordMock: vi.fn(),
}));

vi.mock("next-auth", () => ({
  default: nextAuthMock,
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: vi.fn((config) => config),
}));

vi.mock("@/lib/db", () => ({
  db: {},
}));

vi.mock("@/persistence/schema/auth", () => ({
  users: {},
  loginEmails: {},
}));

vi.mock("@/modules/auth/server/authenticate-with-otp", () => ({
  authenticateWithOTP: authenticateWithOTPMock,
}));

vi.mock("@/modules/auth/server/complete-interactive-sign-in", () => ({
  completeInteractiveSignIn: completeInteractiveSignInMock,
}));

vi.mock("@/modules/auth/server/authenticate-with-password", () => ({
  authenticateWithPassword: authenticateWithPasswordMock,
}));

vi.mock("@/modules/auth/server/session-user", () => ({
  getSessionUser: getSessionUserMock,
}));

nextAuthMock.mockImplementation((config) => {
  return {
    handlers: { GET: vi.fn(), POST: vi.fn() },
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    __config: config,
  };
});

describe("auth.ts adapter wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    authenticateWithOTPMock.mockResolvedValue({
      id: "user-authenticate",
      email: "user@example.com",
    });
    completeInteractiveSignInMock.mockImplementation(async (principal) => principal);
    getSessionUserMock.mockResolvedValue({
      id: "db-user",
      email: "db@example.com",
      passwordHash: "hashed-password",
      passwordUpdatedAt: new Date("2026-07-01T00:00:00.000Z"),
      authVersion: 1,
    });
  });

  async function loadAuthOptions() {
    vi.doUnmock("@/auth");
    const authModule = await import("@/auth");
    const authOptions = nextAuthMock.mock.calls.at(-1)?.[0];
    return { authModule, authOptions };
  }

  it("delegates authorize to authenticateWithOTP", async () => {
    const { authOptions } = await loadAuthOptions();
    const otpProvider = authOptions?.providers?.find?.(
      (provider: { id?: string }) => provider.id === "otp"
    );

    const request = { headers: new Headers({ "x-forwarded-for": "127.0.0.1" }) };
    const result = await otpProvider?.authorize?.(
      { email: "user@example.com", otp: "123456" },
      request
    );

    expect(authenticateWithOTPMock).toHaveBeenCalledWith({
      email: "user@example.com",
      otp: "123456",
      requestHeaders: request.headers,
    });
    expect(result).toMatchObject({ email: "user@example.com" });
  }, 30_000);

  it("hands the password provider its credentials and the request headers", async () => {
    authenticateWithPasswordMock.mockResolvedValueOnce({
      id: "db-user",
      email: "user@example.com",
      authVersion: 1,
      registrationCompletedAt: new Date(),
    });
    const { authOptions } = await loadAuthOptions();
    const passwordProvider = authOptions?.providers?.find?.(
      (provider: { id?: string }) => provider.id === "password"
    );
    const request = { headers: new Headers() };

    await passwordProvider?.authorize?.({ email: "user@example.com", password: "secret" }, request);

    expect(authenticateWithPasswordMock).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret",
      requestHeaders: request.headers,
    });
  });

  it("does not register a duplicate createUser ledger hook", async () => {
    const { authModule, authOptions } = await loadAuthOptions();
    const createUserEvent = authOptions?.events?.createUser as
      ((params: { user: { id?: string | null } }) => Promise<void>) | undefined;

    expect(authModule).toBeDefined();
    expect(createUserEvent).toBeUndefined();
  });

  it("does not register a duplicate signIn event", async () => {
    const { authOptions } = await loadAuthOptions();
    expect(authOptions?.events?.signIn).toBeUndefined();
  });

  it("does not register a duplicate signIn callback", async () => {
    const { authOptions } = await loadAuthOptions();
    expect(authOptions?.callbacks?.signIn).toBeUndefined();
  });

  it("hydrates session data through the auth session query", async () => {
    const { authOptions } = await loadAuthOptions();
    const sessionCallback = authOptions?.callbacks?.session as
      | ((params: {
          session: {
            user?: {
              id?: string;
              email?: string | null;
            };
          };
          token: { sub?: string | null; authVersion?: number; authenticatedAt?: number };
        }) => Promise<{
          user?: {
            id?: string;
            email?: string | null;
          };
        }>)
      | undefined;

    const result = await sessionCallback?.({
      session: { user: { id: "session-user", email: "old@example.com" } },
      token: { sub: "db-user", authVersion: 1, authenticatedAt: 1_800_000_000 },
    });

    expect(getSessionUserMock).toHaveBeenCalledWith("db-user");
    expect(result).toEqual({
      user: {
        id: "db-user",
        email: "db@example.com",
        hasPassword: true,
        passwordUpdatedAt: "2026-07-01T00:00:00.000Z",
        authenticatedAt: "2027-01-15T08:00:00.000Z",
      },
    });
  });

  it("keeps authenticatedAt fixed across ordinary JWT refreshes", async () => {
    const { authOptions } = await loadAuthOptions();
    const jwtCallback = authOptions?.callbacks?.jwt;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00.000Z"));
    const issuedAt = Math.floor(Date.now() / 1000);
    const issued = await jwtCallback?.({
      token: { iat: 1_800_000_000 },
      user: { id: "db-user", authVersion: 3 },
    });
    vi.setSystemTime(new Date("2026-08-23T12:05:00.000Z"));
    const refreshed = await jwtCallback?.({ token: issued, user: undefined });

    expect(issued).toMatchObject({
      sub: "db-user",
      authVersion: 3,
      authenticatedAt: issuedAt,
    });
    expect(refreshed?.authenticatedAt).toBe(issued?.authenticatedAt);
    vi.useRealTimers();
  });

  it("rejects a session whose token auth version is stale", async () => {
    const { authOptions } = await loadAuthOptions();
    const sessionCallback = authOptions?.callbacks?.session;
    getSessionUserMock.mockResolvedValueOnce({
      id: "db-user",
      email: "db@example.com",
      passwordHash: null,
      passwordUpdatedAt: null,
      authVersion: 2,
      registrationCompletedAt: new Date(),
    });

    await expect(
      sessionCallback?.({
        session: { user: { id: "db-user" } },
        token: { sub: "db-user", authVersion: 1, authenticatedAt: 1_800_000_000 },
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("accepts legacy version-one tokens but not their re-signed iat as a sign-in time", async () => {
    const { authOptions } = await loadAuthOptions();
    const sessionCallback = authOptions?.callbacks?.session;
    const result = await sessionCallback?.({
      session: { user: { id: "db-user" } },
      token: { sub: "db-user", authenticatedAt: 1_800_000_000 },
    });
    expect(result?.user?.authenticatedAt).toBe("2027-01-15T08:00:00.000Z");

    await expect(
      sessionCallback?.({
        session: { user: { id: "db-user" } },
        token: { sub: "db-user", iat: 1_800_000_000 },
      })
    ).rejects.toThrow("Session authentication time is missing");
  });

  it("rethrows missing-user session errors from the auth session query", async () => {
    const { authOptions } = await loadAuthOptions();
    const sessionCallback = authOptions?.callbacks?.session as
      | ((params: {
          session: {
            user?: {
              id?: string;
              email?: string | null;
            };
          };
          token: { sub?: string | null };
        }) => Promise<unknown>)
      | undefined;

    getSessionUserMock.mockRejectedValueOnce(new UnauthorizedError("User not found in database"));

    await expect(
      sessionCallback?.({
        session: {
          user: { id: "session-user", email: "old@example.com" },
        },
        token: { sub: "missing-user" },
      })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
