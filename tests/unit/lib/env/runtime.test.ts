import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://cashier:cashier@localhost:5432/cashier",
  API_KEY_PEPPER: "test-pepper",
  OPENAI_API_KEY: "sk-test",
  AUTH_SECRET: "auth-secret",
  AUTH_OTP_PEPPER: "otp-pepper",
  APP_URL: "http://localhost:3000",
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "cashier-images",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
} satisfies NodeJS.ProcessEnv;

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("runtimeEnv", () => {
  it("revalidates changed raw values without caching failures", async () => {
    const { getStartupEnvValue } = await import("@/lib/env/startup");
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", AI_MAX_RETRIES: "5" };
    expect(getStartupEnvValue("AI_MAX_RETRIES", env)).toBe(5);
    expect(getStartupEnvValue("AI_MAX_RETRIES", env)).toBe(5);
    env.AI_MAX_RETRIES = "invalid";
    expect(() => getStartupEnvValue("AI_MAX_RETRIES", env)).toThrow("AI_MAX_RETRIES");
    env.AI_MAX_RETRIES = "2";
    expect(getStartupEnvValue("AI_MAX_RETRIES", env)).toBe(2);
    delete env.AI_MAX_RETRIES;
    expect(getStartupEnvValue("AI_MAX_RETRIES", env)).toBe(3);
  });
  it("reads validated application env through typed accessors", async () => {
    process.env = {
      ...originalEnv,
      ...baseEnv,
      AI_MAX_RETRIES: "5",
      AI_MODEL: "custom-model",
      AI_RETRY_DELAY_MS: "1500",
      AI_TEMPERATURE: "0.7",
      AUTH_RATE_LIMIT_MAX: "12",
      AUTH_RATE_LIMIT_WINDOW: "600",
      AUTH_PASSWORD_EMAIL_MAX_ATTEMPTS: "11",
      AUTH_PASSWORD_IP_MAX_ATTEMPTS: "51",
      AUTH_PASSWORD_RATE_LIMIT_WINDOW_SECONDS: "601",
      AUTH_EMAIL_FROM: "Cashier <security@example.com>",
      LOG_LEVEL: "warn",
      MAX_IMAGE_QUALITY: "72",
      MAX_INPUT_PIXELS: "123456",
      OTP_EXPIRES_SECONDS: "420",
      OTP_LOCKOUT_MINUTES: "20",
      OTP_MAX_ATTEMPTS: "7",
      OTP_RESEND_COOLDOWN_SECONDS: "90",
      OTP_IP_MAX_ATTEMPTS_PER_HOUR: "14",
      OTP_VERIFY_MAX_ATTEMPTS_PER_MINUTE: "6",
      API_RATE_LIMIT_PER_MINUTE: "75",
      SESSION_MAX_AGE_DAYS: "21",
      SOURCE_DOC_STALE_TIME_MS: "654321",
      CURRENCY_STALE_TIME_MS: "7654321",
      TZ: "UTC",
      TRUSTED_PROXY: "platform",
      AUTH_RESEND_KEY: "re_test",
      OPENAI_BASE_URL: "https://openai-proxy.example/v1",
    };

    const { runtimeEnv } = await import("@/lib/env/runtime");

    expect(runtimeEnv.databaseUrl).toBe("postgresql://cashier:cashier@localhost:5432/cashier");
    expect(runtimeEnv.apiKeyPepper).toBe("test-pepper");
    expect(runtimeEnv.openaiApiKey).toBe("sk-test");
    expect(runtimeEnv.openaiBaseUrl).toBe("https://openai-proxy.example/v1");
    expect(runtimeEnv.hasOpenaiBaseUrl).toBe(true);
    expect(runtimeEnv.appUrl).toBe("http://localhost:3000");
    expect(runtimeEnv.authResendKey).toBe("re_test");
    expect(runtimeEnv.authEmailFrom).toBe("Cashier <security@example.com>");
    expect(runtimeEnv.s3Endpoint).toBe("http://localhost:9000");
    expect(runtimeEnv.s3Bucket).toBe("cashier-images");
    expect(runtimeEnv.s3AccessKeyId).toBe("test-access-key");
    expect(runtimeEnv.s3SecretAccessKey).toBe("test-secret-key");
    expect(runtimeEnv.trustedProxy).toBe("platform");
    expect(runtimeEnv.timeZone).toBe("UTC");
    expect(runtimeEnv.aiModel).toBe("custom-model");
    expect(runtimeEnv.aiMaxRetries).toBe(5);
    expect(runtimeEnv.aiRetryDelayMs).toBe(1500);
    expect(runtimeEnv.aiTemperature).toBe(0.7);
    expect(runtimeEnv.sourceDocStaleTimeMs).toBe(654321);
    expect(runtimeEnv.currencyStaleTimeMs).toBe(7654321);
    expect(runtimeEnv.otpExpiresSeconds).toBe(420);
    expect(runtimeEnv.otpLockoutMinutes).toBe(20);
    expect(runtimeEnv.otpMaxAttempts).toBe(7);
    expect(runtimeEnv.otpResendCooldownSeconds).toBe(90);
    expect(runtimeEnv.authRateLimitMax).toBe(12);
    expect(runtimeEnv.authRateLimitWindow).toBe(600);
    expect(runtimeEnv.authPasswordEmailMaxAttempts).toBe(11);
    expect(runtimeEnv.authPasswordIpMaxAttempts).toBe(51);
    expect(runtimeEnv.authPasswordRateLimitWindowSeconds).toBe(601);
    expect(runtimeEnv.otpIpMaxAttemptsPerHour).toBe(14);
    expect(runtimeEnv.otpVerifyMaxAttemptsPerMinute).toBe(6);
    expect(runtimeEnv.apiRateLimitPerMinute).toBe(75);
    expect(runtimeEnv.sessionMaxAgeDays).toBe(21);
    expect(runtimeEnv.maxInputPixels).toBe(123456);
    expect(runtimeEnv.maxImageQuality).toBe(72);
    expect(runtimeEnv.logLevel).toBe("warn");
  });

  it("surfaces startup validation failures through the accessor", async () => {
    process.env = {
      ...originalEnv,
      ...baseEnv,
      OPENAI_API_KEY: "",
    };

    const { runtimeEnv } = await import("@/lib/env/runtime");

    expect(() => runtimeEnv.openaiApiKey).toThrow(/OPENAI_API_KEY/);
  });

  it("tracks whether OPENAI_BASE_URL was explicitly configured", async () => {
    process.env = {
      ...originalEnv,
      ...baseEnv,
      OPENAI_BASE_URL: "",
    };

    const { runtimeEnv } = await import("@/lib/env/runtime");

    expect(runtimeEnv.openaiBaseUrl).toBe("https://api.openai.com/v1");
    expect(runtimeEnv.hasOpenaiBaseUrl).toBe(false);
  });

  it("allows reading databaseUrl without unrelated required secrets", async () => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: "postgresql://cashier:cashier@localhost:5432/cashier",
      OPENAI_API_KEY: "",
      AUTH_SECRET: "",
      APP_URL: "http://localhost:3000",
    };

    const { runtimeEnv } = await import("@/lib/env/runtime");

    expect(runtimeEnv.databaseUrl).toBe("postgresql://cashier:cashier@localhost:5432/cashier");
  });
});
