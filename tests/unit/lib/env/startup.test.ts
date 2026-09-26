import { describe, expect, it } from "vitest";
import { ENV_DEFAULTS, validateStartupEnv } from "@/lib/env/startup";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://cashier:cashier@localhost:5432/cashier",
  API_KEY_PEPPER: "test-pepper",
  OPENAI_API_KEY: "sk-test",
  AUTH_SECRET: "auth-secret",
  APP_URL: "http://localhost:3000",
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "cashier-images",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
} satisfies NodeJS.ProcessEnv;

describe("validateStartupEnv", () => {
  it("exports the default values used by startup, runtime, and public env readers", () => {
    expect(ENV_DEFAULTS.OPENAI_BASE_URL).toBe("https://api.openai.com/v1");
    expect(ENV_DEFAULTS.AI_MODEL).toBe("gpt-4o");
    expect(ENV_DEFAULTS.APP_URL).toBe("http://localhost:3000");
  });

  it("rejects SQLite database URLs", () => {
    expect(() =>
      validateStartupEnv({
        ...baseEnv,
        DATABASE_URL: "file:./data/sqlite.db",
      })
    ).toThrow(/PostgreSQL/);
  });

  it("reports missing required startup env vars together", () => {
    expect(() =>
      validateStartupEnv({
        ...baseEnv,
        OPENAI_API_KEY: "",
        AUTH_SECRET: "",
      })
    ).toThrow(/OPENAI_API_KEY|AUTH_SECRET/);
  });

  it("requires every S3 setting without exposing configured credentials", () => {
    let message = "";
    try {
      validateStartupEnv({
        ...baseEnv,
        S3_BUCKET: "",
        S3_SECRET_ACCESS_KEY: "do-not-log-this-secret",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("S3_BUCKET");
    expect(message).not.toContain("do-not-log-this-secret");
  });

  it("rejects invalid numeric values", () => {
    expect(() =>
      validateStartupEnv({
        ...baseEnv,
        DATABASE_POOL_MAX: "-1",
      })
    ).toThrow(/DATABASE_POOL_MAX/);
  });

  it("applies production defaults independently of test-environment overrides", () => {
    const result = validateStartupEnv({ ...baseEnv, NODE_ENV: "production" });

    expect(result.AI_MODEL).toBe("gpt-4o");
    expect(result.DATABASE_POOL_MAX).toBe(2);
  });

  it("accepts an absent or platform-managed trusted proxy", () => {
    expect(
      validateStartupEnv({
        ...baseEnv,
        NODE_ENV: "production",
      }).TRUSTED_PROXY
    ).toBeUndefined();

    expect(
      validateStartupEnv({
        ...baseEnv,
        NODE_ENV: "production",
        TRUSTED_PROXY: "platform",
      }).TRUSTED_PROXY
    ).toBe("platform");

    expect(() =>
      validateStartupEnv({
        ...baseEnv,
        TRUSTED_PROXY: "true",
      })
    ).toThrow(/TRUSTED_PROXY/);
  });

  it("only permits DEV_AUTH_BYPASS in tests or loopback development", () => {
    expect(validateStartupEnv({ ...baseEnv, DEV_AUTH_BYPASS: "true" }).DEV_AUTH_BYPASS).toBe(
      "true"
    );
    expect(
      validateStartupEnv({
        ...baseEnv,
        NODE_ENV: "development",
        DEV_AUTH_BYPASS: "true",
        APP_URL: "http://127.0.0.1:3000",
      }).DEV_AUTH_BYPASS
    ).toBe("true");
    expect(
      validateStartupEnv({
        ...baseEnv,
        NODE_ENV: "development",
        DEV_AUTH_BYPASS: "true",
        APP_URL: "http://[::1]:3000",
      }).DEV_AUTH_BYPASS
    ).toBe("true");

    expect(() =>
      validateStartupEnv({
        ...baseEnv,
        NODE_ENV: "development",
        DEV_AUTH_BYPASS: "true",
        APP_URL: "https://dev.example.com",
      })
    ).toThrow(/DEV_AUTH_BYPASS/);
    expect(() =>
      validateStartupEnv({
        ...baseEnv,
        NODE_ENV: "production",
        DEV_AUTH_BYPASS: "true",
      })
    ).toThrow(/DEV_AUTH_BYPASS/);
  });

  it("accepts AUTH_EMAIL_FROM in named mailbox format", () => {
    const result = validateStartupEnv({
      ...baseEnv,
      AUTH_EMAIL_FROM: "Cashier <noreply@example.com>",
    });

    expect(result.AUTH_EMAIL_FROM).toBe("Cashier <noreply@example.com>");
  });

  it("rejects invalid AUTH_EMAIL_FROM", () => {
    expect(() =>
      validateStartupEnv({
        ...baseEnv,
        AUTH_EMAIL_FROM: "not-an-email",
      })
    ).toThrow(/AUTH_EMAIL_FROM/);
  });

  it("requires AUTH_SECRET", () => {
    expect(() =>
      validateStartupEnv({
        ...baseEnv,
        AUTH_SECRET: "",
      })
    ).toThrow(/AUTH_SECRET/);
  });

  it("does not require the old API key pepper", () => {
    const { API_KEY_PEPPER: _api, ...env } = baseEnv;
    expect(() => validateStartupEnv(env)).not.toThrow();
  });

  it("owns all app env defaults in the startup module", () => {
    expect(Object.keys(ENV_DEFAULTS).sort()).toEqual([
      "AI_MODEL",
      "APP_URL",
      "AUTH_EMAIL_FROM",
      "DATABASE_POOL_MAX",
      "DEV_AUTH_BYPASS",
      "LOG_LEVEL",
      "OPENAI_BASE_URL",
      "S3_FORCE_PATH_STYLE",
      "S3_REGION",
      "TZ",
    ]);
  });
});
