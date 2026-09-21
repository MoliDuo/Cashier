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
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", DATABASE_POOL_MAX: "5" };
    expect(getStartupEnvValue("DATABASE_POOL_MAX", env)).toBe(5);
    expect(getStartupEnvValue("DATABASE_POOL_MAX", env)).toBe(5);
    env.DATABASE_POOL_MAX = "invalid";
    expect(() => getStartupEnvValue("DATABASE_POOL_MAX", env)).toThrow("DATABASE_POOL_MAX");
    env.DATABASE_POOL_MAX = "2";
    expect(getStartupEnvValue("DATABASE_POOL_MAX", env)).toBe(2);
    delete env.DATABASE_POOL_MAX;
    expect(getStartupEnvValue("DATABASE_POOL_MAX", env)).toBe(2);
  });
  it("reads validated application env through typed accessors", async () => {
    process.env = {
      ...originalEnv,
      ...baseEnv,
      AI_MODEL: "custom-model",
      AUTH_EMAIL_FROM: "Cashier <security@example.com>",
      LOG_LEVEL: "warn",
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
