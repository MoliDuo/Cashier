import { beforeEach, describe, expect, it, vi } from "vitest";

const { nextAuthMock } = vi.hoisted(() => ({
  nextAuthMock: vi.fn((config: unknown) => ({
    config,
    handlers: { GET: vi.fn(), POST: vi.fn() },
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));

vi.mock("next-auth", () => ({
  default: nextAuthMock,
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: (config: Record<string, unknown>) => ({
    ...config,
    type: "credentials",
  }),
}));

vi.mock("@/modules/auth/application/use-cases/authenticate-with-otp", () => ({
  authenticateWithOTP: vi.fn(),
}));

vi.mock("@/modules/auth/application/use-cases/authenticate-with-password", () => ({
  authenticateWithPassword: vi.fn(),
}));

vi.mock("@/modules/auth/application/queries/get-session-user", () => ({
  getSessionUser: vi.fn(async (id: string) => ({
    id,
    email: "test@example.com",
  })),
}));

describe("auth runtime config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.DEV_AUTH_BYPASS;
  });

  it("preserves resolved auth pages", async () => {
    vi.doUnmock("@/auth");

    const authModule = await import("@/auth");

    expect(authModule.authOptions.pages).toEqual({
      signIn: "/login",
      error: "/login/error",
    });

    expect(nextAuthMock).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("registers password and email OTP credentials providers without a database adapter", async () => {
    process.env.DEV_AUTH_BYPASS = "false";
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    vi.doUnmock("@/auth");

    await import("@/auth");

    const config = nextAuthMock.mock.calls[0]?.[0] as
      | {
          adapter?: unknown;
          providers?: Array<{ id?: string; name?: string; type?: string }>;
        }
      | undefined;

    expect(config?.adapter).toBeUndefined();
    expect(config?.providers).toHaveLength(2);
    expect(config?.providers?.[0]).toMatchObject({
      id: "otp",
      type: "credentials",
    });
    expect(config?.providers?.map((provider) => provider.id)).toEqual(["otp", "password"]);
  });

  it("registers the dev provider only when local dev bypass is enabled", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.DEV_AUTH_BYPASS = "true";
    vi.doUnmock("@/auth");

    await import("@/auth");

    const config = nextAuthMock.mock.calls[0]?.[0] as
      | {
          providers?: Array<{ id?: string; name?: string; type?: string }>;
        }
      | undefined;

    expect(config?.providers?.map((provider) => provider.id)).toEqual(["otp", "password", "dev"]);
  });
});
