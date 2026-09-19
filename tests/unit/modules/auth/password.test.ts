import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { UserAccountPort } from "@/application/contracts";
import { AppError } from "@/lib/errors";
import { authenticateWithPassword } from "@/modules/auth/application/use-cases/authenticate-with-password";
import { changePassword } from "@/modules/auth/application/use-cases/change-password";
import { AUTH_ERROR_CODES } from "@/modules/auth/errors";
import {
  getPasswordRuleViolation,
  PASSWORD_RULE_MESSAGES,
  type PasswordRuleViolation,
} from "@/modules/auth/password-rules";
import { hashPassword, verifyPassword } from "@/modules/auth/services/password";
import { validatePassword } from "@/modules/auth/services/password-policy";
import type { AccountSecurityPort } from "@/modules/auth/application/ports";
import { collectImportSpecifiers } from "../../../../scripts/architecture-imports.mjs";

describe("password authentication", () => {
  const rateLimiter = {
    increment: async () => ({ success: true, remaining: 9, resetTime: Date.now() + 900_000 }),
    releaseIncrement: async () => {},
    current: async () => 0,
    acquireCooldown: async () => ({ acquired: true, acquiredAt: new Date(), retryAfter: 0 }),
    releaseCooldown: async () => true,
    setCooldown: async () => {},
    getCooldownRemaining: async () => 0,
  };

  it("hashes and verifies passwords without storing plaintext", async () => {
    const hash = await hashPassword("correct-horse-9");
    expect(hash).not.toContain("correct-horse-9");
    expect(bcrypt.getRounds(hash)).toBe(12);
    await expect(verifyPassword("correct-horse-9", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password-9", hash)).resolves.toBe(false);
  });

  it("rejects malformed and unsupported bcrypt hashes without comparing", async () => {
    const compare = vi.spyOn(bcrypt, "compare");

    await expect(verifyPassword("valid-password-1", "$2b$09$invalid")).resolves.toBe(false);
    await expect(
      verifyPassword(
        "valid-password-1",
        "$2b$15$E.Rov9WCSx5iCVVlYJTgLOGGjHYsuet/YKxmEZ03AXS8OY.ivReI2"
      )
    ).resolves.toBe(false);
    await expect(
      verifyPassword(
        "valid-password-1",
        "$2x$12$E.Rov9WCSx5iCVVlYJTgLOGGjHYsuet/YKxmEZ03AXS8OY.ivReI2"
      )
    ).resolves.toBe(false);

    expect(compare).not.toHaveBeenCalled();
    compare.mockRestore();
  });

  it("enforces the compact password policy", () => {
    expect(() => validatePassword("short1")).toThrow(/8 and 128/);
    expect(() => validatePassword("onlyletters")).toThrow(/letter and one number/);
    expect(() => validatePassword("valid-password-1")).not.toThrow();
    expect(() => validatePassword(`${"a".repeat(70)}1x`)).not.toThrow();
    expect(() => validatePassword(`${"a".repeat(71)}1x`)).toThrow(/72 UTF-8 bytes/);
  });

  it("returns the user for valid credentials and hides failure details", async () => {
    const passwordHash = await bcrypt.hash("valid-password-1", 10);
    const account = {
      id: "user-id",
      email: "owner@example.com",
      name: null,
      image: null,
      passwordHash,
      passwordUpdatedAt: new Date(),
      authVersion: 1,
      registrationCompletedAt: new Date(),
    };
    const users = {
      findByEmail: async (email: string) => (email === account.email ? account : null),
    } as UserAccountPort;

    await expect(
      authenticateWithPassword(
        {
          email: " OWNER@example.com ",
          password: "valid-password-1",
          requestHeaders: new Headers(),
        },
        { users, rateLimiter }
      )
    ).resolves.toMatchObject({ id: "user-id", email: "owner@example.com" });
    await expect(
      authenticateWithPassword(
        {
          email: "owner@example.com",
          password: "wrong-password-1",
          requestHeaders: new Headers(),
        },
        { users, rateLimiter }
      )
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(
      authenticateWithPassword(
        {
          email: "missing@example.com",
          password: "wrong-password-1",
          requestHeaders: new Headers(),
        },
        { users, rateLimiter }
      )
    ).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("releases the reserved rate-limit bucket for a successful password login", async () => {
    const passwordHash = await bcrypt.hash("valid-password-1", 10);
    const increment = vi.fn().mockResolvedValue({
      success: true,
      remaining: 9,
      resetTime: Date.now() + 900_000,
    });
    const releaseIncrement = vi.fn();
    const users = {
      findByEmail: vi.fn().mockResolvedValue({
        id: "user-id",
        email: "owner@example.com",
        name: null,
        image: null,
        passwordHash,
        passwordUpdatedAt: new Date(),
        authVersion: 2,
        registrationCompletedAt: new Date(),
      }),
    } as unknown as UserAccountPort;

    await authenticateWithPassword(
      {
        email: "owner@example.com",
        password: "valid-password-1",
        locale: "en",
        requestHeaders: new Headers(),
      },
      { users, rateLimiter: { ...rateLimiter, increment, releaseIncrement } }
    );

    expect(increment).toHaveBeenCalledTimes(2);
    expect(releaseIncrement).toHaveBeenCalledTimes(2);
    expect(releaseIncrement).toHaveBeenCalledWith(
      "auth:password:email:owner@example.com",
      expect.any(Number),
      expect.any(Number)
    );
  });

  it("runs a dummy bcrypt comparison for unknown users", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    const findByEmail = vi.fn().mockResolvedValue(null);

    await expect(
      authenticateWithPassword(
        {
          email: "missing@example.com",
          password: "wrong-password-1",
          requestHeaders: new Headers(),
        },
        {
          users: { findByEmail } as unknown as UserAccountPort,
          rateLimiter,
        }
      )
    ).rejects.toMatchObject({ code: "invalid_credentials" });

    expect(compare).toHaveBeenCalledWith("wrong-password-1", expect.stringMatching(/^\$2b\$12\$/));
    compare.mockRestore();
  });

  it("blocks password verification when either rate-limit bucket is unavailable or exhausted", async () => {
    const findByEmail = vi.fn();
    const compare = vi.spyOn(bcrypt, "compare");
    const unavailableRateLimiter = {
      ...rateLimiter,
      increment: vi.fn().mockRejectedValue(new Error("rate limiter down")),
    };

    await expect(
      authenticateWithPassword(
        {
          email: "owner@example.com",
          password: "valid-password-1",
          requestHeaders: new Headers(),
        },
        {
          users: { findByEmail } as unknown as UserAccountPort,
          rateLimiter: unavailableRateLimiter,
        }
      )
    ).rejects.toMatchObject({ code: "password_rate_limit_unavailable" });

    expect(findByEmail).not.toHaveBeenCalled();
    expect(compare).not.toHaveBeenCalled();
    compare.mockRestore();

    const limitedRateLimiter = {
      ...rateLimiter,
      increment: vi.fn().mockResolvedValue({
        success: false,
        remaining: 0,
        resetTime: Date.now() + 900_000,
      }),
    };
    await expect(
      authenticateWithPassword(
        {
          email: "owner@example.com",
          password: "valid-password-1",
          requestHeaders: new Headers(),
        },
        {
          users: { findByEmail } as unknown as UserAccountPort,
          rateLimiter: limitedRateLimiter,
        }
      )
    ).rejects.toMatchObject({ code: "password_rate_limited" });
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it("uses a stable hashed IP bucket when the client address is unknown", async () => {
    const increment = vi.fn().mockResolvedValue({
      success: true,
      remaining: 9,
      resetTime: Date.now() + 900_000,
    });
    const users = {
      findByEmail: vi.fn().mockResolvedValue(null),
    } as unknown as UserAccountPort;

    await expect(
      authenticateWithPassword(
        {
          email: "owner@example.com",
          password: "wrong-password-1",
          requestHeaders: new Headers(),
        },
        { users, rateLimiter: { ...rateLimiter, increment } }
      )
    ).rejects.toMatchObject({ code: "invalid_credentials" });

    expect(increment).toHaveBeenCalledTimes(2);
    expect(increment.mock.calls[0]?.[0]).toBe("auth:password:email:owner@example.com");
    expect(increment.mock.calls[1]?.[0]).toMatch(/^auth:password:ip:ip:[a-f0-9]+$/);
    expect(increment.mock.calls[1]?.[0]).not.toContain("unknown");
  });

  it("atomically caps concurrent password sign-in verification", async () => {
    const passwordHash = await bcrypt.hash("valid-password-1", 10);
    let count = 0;
    const increment = vi.fn(async (_key: string, limit: number, windowSeconds: number) => {
      count += 1;
      return {
        success: count <= limit,
        remaining: Math.max(0, limit - count),
        resetTime: Date.now() + windowSeconds * 1000,
      };
    });
    const findByEmail = vi.fn().mockResolvedValue({
      id: "user-id",
      email: "owner@example.com",
      name: null,
      image: null,
      passwordHash,
      passwordUpdatedAt: new Date(),
      authVersion: 1,
      registrationCompletedAt: new Date(),
    });

    await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        authenticateWithPassword(
          {
            email: "owner@example.com",
            password: "wrong-password-1",
            requestHeaders: new Headers(),
          },
          {
            users: { findByEmail } as unknown as UserAccountPort,
            rateLimiter: { ...rateLimiter, increment },
          }
        )
      )
    );

    expect(findByEmail).toHaveBeenCalledTimes(increment.mock.calls[0]![1]);
  });

  it("atomically caps concurrent current-password verification", async () => {
    const passwordHash = await bcrypt.hash("current-password-1", 10);
    let count = 0;
    const increment = vi.fn(async (_key: string, limit: number, windowSeconds: number) => {
      count += 1;
      return {
        success: count <= limit,
        remaining: Math.max(0, limit - count),
        resetTime: Date.now() + windowSeconds * 1000,
      };
    });
    const getPasswordHash = vi.fn().mockResolvedValue(passwordHash);

    await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        changePassword(
          {
            userId: "user-id",
            currentPassword: "wrong-password-1",
            newPassword: "new-password-2",
            confirmPassword: "new-password-2",
          },
          {
            accounts: {
              getPasswordHash,
            } as unknown as AccountSecurityPort,
            rateLimiter: { ...rateLimiter, increment },
          }
        )
      )
    );

    expect(getPasswordHash).toHaveBeenCalledTimes(increment.mock.calls[0]![1]);
  });
});

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

/**
 * Resolve a `@/…` or relative specifier to a repository-relative `src/…` path,
 * or null when the specifier leaves the source tree (a package, for instance).
 */
function resolveSourceModule(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.posix.join("src", specifier.slice(2))
    : specifier.startsWith(".")
      ? path.posix.join(path.posix.dirname(fromFile), specifier)
      : null;
  if (base == null) return null;
  for (const candidate of [base + ".ts", base + ".tsx", path.posix.join(base, "index.ts")]) {
    const absolute = path.join(process.cwd(), candidate);
    if (existsSync(absolute) && statSync(absolute).isFile()) return candidate;
  }
  return null;
}

/** Everything the given entry modules pull in, split into source files and packages. */
function importClosure(entries: string[]): { files: string[]; external: string[] } {
  const files = new Set<string>();
  const external = new Set<string>();
  const pending = [...entries];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of collectImportSpecifiers(readSource(file), file)) {
      const resolved = resolveSourceModule(specifier, file);
      if (resolved == null) external.add(specifier);
      else pending.push(resolved);
    }
  }
  return { files: [...files].sort(), external: [...external].sort() };
}

/**
 * The first-run wizard and the server policy used to state the rules separately
 * and had drifted: the form accepted a 100-character password the policy then
 * refused, because bcrypt only hashes the first 72 bytes. These cases pin the
 * single rule both sides now read, at the byte boundaries that decide it.
 */
describe("shared password rules", () => {
  const cases: Array<[string, string, PasswordRuleViolation | null]> = [
    ["seven characters", "abcdef1", "length"],
    ["eight characters", "abcdefg1", null],
    ["129 characters", "a".repeat(128) + "1", "length"],
    ["72 encoded bytes", "a".repeat(71) + "1", null],
    ["73 encoded bytes", "a".repeat(72) + "1", "bytes"],
    ["100 ASCII characters", "a".repeat(98) + "1x", "bytes"],
    ["Chinese characters below the byte cap", "\u6d4b".repeat(20) + "a1", null],
    ["Chinese characters above the byte cap", "\u6d4b".repeat(25), "bytes"],
    ["emoji above the byte cap", "\u{1f600}".repeat(20), "bytes"],
    ["four emoji with a short suffix", "\u{1f600}".repeat(4) + "a1", null],
    ["digits only", "12345678", "composition"],
    ["letters only", "abcdefgh", "composition"],
    ["spaces kept as typed", "  abcd1 ", null],
  ];

  it.each(cases)("reads %s as %s", (_label, password, expected) => {
    expect(getPasswordRuleViolation(password)).toBe(expected);
  });

  it.each(cases)("holds the policy to the same verdict for %s", (_label, password, expected) => {
    if (expected == null) {
      expect(() => validatePassword(password)).not.toThrow();
      return;
    }
    let rejection: unknown;
    try {
      validatePassword(password);
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(AppError);
    expect((rejection as AppError).message).toBe(PASSWORD_RULE_MESSAGES[expected]);
    expect((rejection as AppError).code).toBe(
      expected === "length"
        ? AUTH_ERROR_CODES.PASSWORD_TOO_SHORT
        : AUTH_ERROR_CODES.PASSWORD_REQUIREMENTS_NOT_MET
    );
  });

  it("keeps the messages the API already answered with", () => {
    expect(PASSWORD_RULE_MESSAGES.length).toBe("Password must be between 8 and 128 characters");
    expect(PASSWORD_RULE_MESSAGES.bytes).toBe("Password must be at most 72 UTF-8 bytes");
    expect(PASSWORD_RULE_MESSAGES.composition).toBe(
      "Password must contain at least one letter and one number"
    );
  });

  it("leaves the shared module with no imports and no environment reads", () => {
    const source = readSource("src/modules/auth/password-rules.ts");
    expect(collectImportSpecifiers(source, "src/modules/auth/password-rules.ts")).toEqual([]);
    expect(source).not.toContain("process.env");
    expect(importClosure(["src/modules/auth/password-rules.ts"])).toEqual({
      files: ["src/modules/auth/password-rules.ts"],
      external: [],
    });
  });

  it("keeps bcrypt, the database and the policy out of the browser's dependency graph", () => {
    const closure = importClosure([
      "src/modules/auth/password-rules.ts",
      "src/modules/setup/contract-schemas.ts",
    ]);

    // The closure has to be walked at all before the exclusions mean anything.
    expect(closure.files).toContain("src/lib/errors.ts");
    expect(closure.external).toContain("zod");
    expect(closure.files).not.toContain("src/modules/auth/services/password-policy.ts");
    for (const forbidden of [
      "bcryptjs",
      "bcrypt",
      "pg",
      "server-only",
      "drizzle-orm",
      "next/headers",
    ]) {
      expect(closure.external).not.toContain(forbidden);
    }
    for (const file of closure.files) {
      expect(file.startsWith("src/application/")).toBe(false);
      expect(file.startsWith("src/persistence/")).toBe(false);
      expect(file).not.toBe("src/lib/db.ts");
    }
  });
});
