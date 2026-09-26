/**
 * Service Credential Token Utilities
 *
 * Generates, hashes, and authenticates service credential tokens using
 * domain-separated HMAC-SHA-256 under a key derived from AUTH_SECRET.
 *
 * Hash format: lowercase hex
 *   HMAC-SHA-256(derived "credential" key, "credential:v1:" + token)
 */

import crypto from "crypto";
import { deriveKey } from "./keys";

export const DOMAIN_PREFIX = "credential:v1:";
const TOKEN_PREFIX = "sk_live_";
const TOKEN_HEX_LENGTH = 48; // 24 random bytes => 48 hex chars
export const DISPLAY_PREFIX_LENGTH = 8;
export const DISPLAY_SUFFIX_LENGTH = 4;

/**
 * Generate a random 48-hex-char token (with `sk_live_` prefix), compute its
 * HMAC-SHA-256 hash, and return everything needed for storage and display.
 */
export function createToken(): {
  token: string;
  hash: string;
  prefix: string;
  suffix: string;
} {
  const randomHex = crypto.randomBytes(TOKEN_HEX_LENGTH / 2).toString("hex");
  const token = `${TOKEN_PREFIX}${randomHex}`;
  const hash = computeHash(token);
  const { prefix, suffix } = prefixSuffix(token);
  return { token, hash, prefix, suffix };
}

/**
 * Derive display prefix (first N chars) and suffix (last N chars) from a full token.
 */
export function prefixSuffix(token: string): { prefix: string; suffix: string } {
  return {
    prefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
    suffix: token.slice(-DISPLAY_SUFFIX_LENGTH),
  };
}

/** The stored hash of a token. */
export function computeHash(token: string): string {
  const hmac = crypto.createHmac("sha256", deriveKey("credential"));
  hmac.update(DOMAIN_PREFIX);
  hmac.update(token);
  return hmac.digest("hex");
}
