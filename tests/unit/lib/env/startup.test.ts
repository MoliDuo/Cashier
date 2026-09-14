import { describe, expect, it } from "vitest";
import { ENV_DEFAULTS, validateStartupEnv } from "@/lib/env/startup";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://cashier:cashier@localhost:5432/cashier",
  API_KEY_PEPPER: "test-pepper",
  RATE_LIMIT_PEPPER: "test-rate-limit-pepper",
  OPENAI_API_KEY: "sk-test",
  AUTH_SECRET: "auth-secret",
  AUTH_OTP_PEPPER: "otp-pepper",
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
        AI_MAX_RETRIES: "-1",
      })
    ).toThrow(/AI_MAX_RETRIES/);
  });

  it("applies production defaults independently of test-environment overrides", () => {
    const result = validateStartupEnv({ ...baseEnv, NODE_ENV: "production" });

    expect(result.AI_MODEL).toBe("gpt-4o");
    expect(result.AI_MAX_RETRIES).toBe(3);
    expect(result.AI_RETRY_DELAY_MS).toBe(1000);
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

  it("requires API_KEY_PEPPER", () => {
    expect(() =>
      validateStartupEnv({
        ...baseEnv,
        API_KEY_PEPPER: "",
      })
    ).toThrow(/API_KEY_PEPPER/);
  });

  it("owns all app env defaults in the startup module", () => {
    expect(Object.keys(ENV_DEFAULTS).sort()).toEqual([
      "AI_CATEGORY_CONCURRENCY",
      "AI_CATEGORY_MAX_ATTEMPTS",
      "AI_CATEGORY_REQUEST_TIMEOUT_MS",
      "AI_MAX_RETRIES",
      "AI_MODEL",
      "AI_REQUEST_TIMEOUT_MS",
      "AI_RETRY_DELAY_MS",
      "AI_REVISION_DEADLINE_MS",
      "AI_TEMPERATURE",
      "API_RATE_LIMIT_PER_MINUTE",
      "APP_URL",
      "AUTH_EMAIL_FROM",
      "AUTH_PASSWORD_EMAIL_MAX_ATTEMPTS",
      "AUTH_PASSWORD_IP_MAX_ATTEMPTS",
      "AUTH_PASSWORD_RATE_LIMIT_WINDOW_SECONDS",
      "AUTH_RATE_LIMIT_MAX",
      "AUTH_RATE_LIMIT_WINDOW",
      "CURRENCY_STALE_TIME_MS",
      "DATABASE_POOL_MAX",
      "DEV_AUTH_BYPASS",
      "DISABLE_REGISTRATION",
      "LOG_LEVEL",
      "MAX_IMAGE_QUALITY",
      "MAX_INPUT_PIXELS",
      "OPENAI_BASE_URL",
      "OTP_EXPIRES_SECONDS",
      "OTP_IP_MAX_ATTEMPTS_PER_HOUR",
      "OTP_LOCKOUT_MINUTES",
      "OTP_MAX_ATTEMPTS",
      "OTP_RESEND_COOLDOWN_SECONDS",
      "OTP_VERIFY_MAX_ATTEMPTS_PER_MINUTE",
      "PROCESSING_RECOVERY_COOLDOWN_SECONDS",
      "PROCESSING_RECOVERY_MAX_ATTEMPTS",
      "PROCESSING_RECOVERY_MAX_BATCH",
      "S3_FORCE_PATH_STYLE",
      "S3_REGION",
      "SESSION_MAX_AGE_DAYS",
      "SOURCE_DOC_STALE_TIME_MS",
      "TZ",
      "UPLOAD_DAILY_BYTES_LIMIT",
      "UPLOAD_OPEN_SESSION_LIMIT",
      "UPLOAD_PLAN_LIMIT_PER_15_MIN",
    ]);
  });
});
