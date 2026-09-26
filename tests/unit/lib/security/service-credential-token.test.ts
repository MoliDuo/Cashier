import { describe, it, expect } from "vitest";
import {
  createToken,
  prefixSuffix,
  computeHash,
  DOMAIN_PREFIX,
  DISPLAY_PREFIX_LENGTH,
  DISPLAY_SUFFIX_LENGTH,
} from "@/lib/security/service-credential-token";
import crypto from "crypto";
import { deriveKey } from "@/lib/security/keys";

describe("computeHash", () => {
  it("produces a deterministic hex HMAC-SHA-256", () => {
    const token = "sk_live_abcdef1234567890abcdef1234567890abcdef12";
    const hash1 = computeHash(token);
    const hash2 = computeHash(token);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keys the hash with the derived credential key, domain-separated", () => {
    const token = "sk_live_test_domain_separation";
    const expected = crypto
      .createHmac("sha256", deriveKey("credential"))
      .update(DOMAIN_PREFIX)
      .update(token)
      .digest("hex");
    expect(computeHash(token)).toBe(expected);
  });

  it("changes with AUTH_SECRET", () => {
    const token = "sk_live_secret_test";
    const original = computeHash(token);
    const secret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "a-different-auth-secret";
    try {
      expect(computeHash(token)).not.toBe(original);
    } finally {
      process.env.AUTH_SECRET = secret;
    }
  });

  it("produces different hashes for different tokens", () => {
    expect(computeHash("sk_live_token_a")).not.toBe(computeHash("sk_live_token_b"));
  });
});

describe("createToken", () => {
  it("generates a well-formed token with hash, prefix, and suffix", () => {
    const result = createToken();

    // Token shape: sk_live_<48 hex chars>
    expect(result.token).toMatch(/^sk_live_[0-9a-f]{48}$/);
    expect(result.token.length).toBe(8 + 48); // "sk_live_" + 48 hex chars

    // Hash is 64 hex chars (SHA-256)
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);

    // Prefix is first 8 chars of token
    expect(result.prefix).toBe(result.token.slice(0, DISPLAY_PREFIX_LENGTH));

    // Suffix is last 4 chars of token
    expect(result.suffix).toBe(result.token.slice(-DISPLAY_SUFFIX_LENGTH));
  });

  it("computes the correct hash for the generated token", () => {
    const result = createToken();
    const expectedHash = computeHash(result.token);
    expect(result.hash).toBe(expectedHash);
  });

  it("generates unique tokens on each call", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(createToken().token);
    }
    expect(tokens.size).toBe(100);
  });
});

describe("prefixSuffix", () => {
  it("returns the correct prefix and suffix for masked display", () => {
    const token = "sk_live_abcdef1234567890abcdef1234567890abcdef12";
    const result = prefixSuffix(token);

    expect(result.prefix).toBe("sk_live_");
    expect(result.suffix).toBe("ef12");
  });

  it("does not reveal the full token", () => {
    const token = "sk_live_secret_token_123456789012345678901234567890";
    const result = prefixSuffix(token);

    // Prefix + suffix should be much shorter than the full token
    expect((result.prefix + result.suffix).length).toBeLessThan(token.length);

    // Neither prefix nor suffix should contain the middle portion
    const middle = token.slice(DISPLAY_PREFIX_LENGTH, -DISPLAY_SUFFIX_LENGTH);
    expect(result.prefix).not.toContain(middle);
    expect(result.suffix).not.toContain(middle);
  });
});
