import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const validateStartupEnv = vi.fn((): Record<string, string | undefined> => ({
  DATABASE_URL: "file:./data/sqlite.db",
  S3_BUCKET: "cashier-images",
}));

vi.mock("@/lib/logger", () => ({
  logger,
}));

vi.mock("@/lib/env/startup", () => ({
  validateStartupEnv,
}));

describe("instrumentation.register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_RUNTIME = "nodejs";
  });

  it("validates startup env without installing process-global orchestration", async () => {
    const { register } = await import("@/instrumentation");

    await register();

    expect(validateStartupEnv).toHaveBeenCalledTimes(1);
    // Accounts come from `account:create`; boot prints no codes or links.
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns once when only one of INSIGHT_URL and INSIGHT_KEY is set", async () => {
    const { register } = await import("@/instrumentation");
    const base = { DATABASE_URL: "x", S3_BUCKET: "b" };

    validateStartupEnv.mockReturnValueOnce({ ...base, INSIGHT_URL: "https://insight.example" });
    await register();
    expect(logger.warn).toHaveBeenCalledTimes(1);

    validateStartupEnv.mockReturnValueOnce({ ...base, INSIGHT_KEY: "mi_key" });
    await register();
    expect(logger.warn).toHaveBeenCalledTimes(2);

    validateStartupEnv.mockReturnValueOnce({
      ...base,
      INSIGHT_URL: "https://insight.example",
      INSIGHT_KEY: "mi_key",
    });
    await register();
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("rethrows startup env validation failures", async () => {
    validateStartupEnv.mockImplementationOnce(() => {
      throw new Error("invalid env");
    });

    const { register } = await import("@/instrumentation");

    await expect(register()).rejects.toThrow("invalid env");
    expect(logger.error).toHaveBeenCalled();
  });
});
