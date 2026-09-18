import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const validateStartupEnv = vi.fn(() => ({
  DATABASE_URL: "file:./data/sqlite.db",
  S3_BUCKET: "cashier-images",
}));

const setupPort = {
  isPending: vi.fn(),
  getOrCreateCode: vi.fn(),
};

vi.mock("@/lib/logger", () => ({
  logger,
}));

vi.mock("@/lib/env/startup", () => ({
  validateStartupEnv,
}));

vi.mock("@/application/server-composition-root", () => ({
  serverComposition: { setup: setupPort },
}));

describe("instrumentation.register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_RUNTIME = "nodejs";
    setupPort.isPending.mockResolvedValue(false);
  });

  it("validates startup env without installing process-global orchestration", async () => {
    const { register } = await import("@/instrumentation");

    await register();

    expect(validateStartupEnv).toHaveBeenCalledTimes(1);
  });

  it("rethrows startup env validation failures", async () => {
    validateStartupEnv.mockImplementationOnce(() => {
      throw new Error("invalid env");
    });

    const { register } = await import("@/instrumentation");

    await expect(register()).rejects.toThrow("invalid env");
    expect(logger.error).toHaveBeenCalled();
  });

  it("prints the setup code at boot while setup is pending", async () => {
    setupPort.isPending.mockResolvedValue(true);
    setupPort.getOrCreateCode.mockResolvedValue({
      code: "12345678",
      created: true,
      issuedAt: new Date("2026-09-18T01:00:00.000Z"),
    });

    const { register } = await import("@/instrumentation");
    await register();

    // The operator learns setup has not run from the startup logs, together with
    // the code the wizard is about to ask for.
    expect(logger.warn).toHaveBeenCalledWith(
      { setupCode: "12345678" },
      expect.stringContaining("First-run setup is pending")
    );
  });

  it("names when an unreadable code was issued instead of printing nothing", async () => {
    setupPort.isPending.mockResolvedValue(true);
    // A code that was already issued has no readable plaintext left, so the log
    // reports its age rather than claiming to hand out a new one.
    setupPort.getOrCreateCode.mockResolvedValue({
      code: "",
      created: false,
      issuedAt: new Date("2026-09-18T01:00:00.000Z"),
    });

    const { register } = await import("@/instrumentation");
    await register();

    expect(logger.warn).toHaveBeenCalledWith(
      { issuedAt: "2026-09-18T01:00:00.000Z" },
      expect.stringContaining("was issued at")
    );
  });

  it("starts the process even when the setup check cannot run", async () => {
    setupPort.isPending.mockRejectedValue(new Error("database is not migrated yet"));

    const { register } = await import("@/instrumentation");

    // An unreachable or un-migrated database must not stop the service booting.
    await expect(register()).resolves.toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
