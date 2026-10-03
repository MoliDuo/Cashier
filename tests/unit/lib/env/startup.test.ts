import { describe, expect, it } from "vitest";
import { ENV_DEFAULTS, validateStartupEnv } from "@/lib/env/startup";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://cashier:cashier@localhost:5432/cashier",
  OPENAI_API_KEY: "sk-test",
  AUTH_SECRET: "auth-secret",
  APP_URL: "http://localhost:3000",
  OIDC_ISSUER_URL: "http://localhost:9091",
  OIDC_CLIENT_ID: "cashier",
  OIDC_CLIENT_SECRET: "client-secret",
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
    expect(result.DATABASE_POOL_MAX).toBe(10);
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

  it("requires the OIDC provider settings, with an issuer that is a URL", () => {
    for (const name of ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"]) {
      expect(() => validateStartupEnv({ ...baseEnv, [name]: "" })).toThrow(new RegExp(name));
    }
    expect(() => validateStartupEnv({ ...baseEnv, OIDC_ISSUER_URL: "not-a-url" })).toThrow(
      /OIDC_ISSUER_URL/
    );
  });

  it("requires AUTH_SECRET", () => {
    expect(() =>
      validateStartupEnv({
        ...baseEnv,
        AUTH_SECRET: "",
      })
    ).toThrow(/AUTH_SECRET/);
  });

  it("owns all app env defaults in the startup module", () => {
    expect(Object.keys(ENV_DEFAULTS).sort()).toEqual([
      "AI_MODEL",
      "APP_URL",
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
