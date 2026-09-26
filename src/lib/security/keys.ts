import { createHmac, hkdfSync } from "node:crypto";
import { runtimeEnv } from "@/lib/env/runtime";

/**
 * Every secret the application keys a digest with is derived from
 * `AUTH_SECRET`, one key per purpose, so a digest made for one use can never
 * be replayed as another's and there is only one secret to provision.
 */
export type KeyPurpose =
  "session" | "otp" | "rate-limit" | "log-identifier" | "credential" | "enrollment";

const derived = new Map<string, Buffer>();

export function deriveKey(purpose: KeyPurpose): Buffer {
  const secret = runtimeEnv.authSecret;
  const cacheKey = `${purpose}\0${secret}`;
  let key = derived.get(cacheKey);
  if (key == null) {
    key = Buffer.from(hkdfSync("sha256", secret, "", `cashier:${purpose}`, 32));
    derived.set(cacheKey, key);
  }
  return key;
}

/** Hex HMAC-SHA-256 of `value` under the purpose's derived key. */
export function keyedDigest(purpose: KeyPurpose, value: string): string {
  return createHmac("sha256", deriveKey(purpose)).update(value).digest("hex");
}
