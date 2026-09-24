import crypto from "crypto";
import { runtimeEnv } from "@/lib/env/runtime";
import { OTP_LENGTH } from "../constants";
import {
  OTP_EXPIRES_SECONDS,
  OTP_LOCKOUT_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
} from "@/config/tuning";

const V2_HASH_PATTERN = /^v2:([a-f0-9]{64}):([a-f0-9]{32})$/;

export function generateOTP(): string {
  const maxValue = Math.pow(10, OTP_LENGTH);
  return crypto.randomInt(0, maxValue).toString().padStart(OTP_LENGTH, "0");
}

export function hashOTP(otp: string): string {
  // Per-token salt keeps token hashes unique even when two accounts receive
  // the same six-digit code; otp_tokens.token_hash has a global unique index.
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .createHmac("sha256", runtimeEnv.authOtpPepper)
    .update(`${salt}:${otp}`)
    .digest("hex");
  return `v2:${hash}:${salt}`;
}

export function verifyOTP(otp: string, storedHash: string): boolean {
  const v2Match = V2_HASH_PATTERN.exec(storedHash);
  if (v2Match == null) return false;
  const expectedHash = v2Match[1]!;
  const salt = v2Match[2]!;
  const computed = crypto
    .createHmac("sha256", runtimeEnv.authOtpPepper)
    .update(`${salt}:${otp}`)
    .digest("hex");

  const hashBuf = Buffer.from(expectedHash, "hex");
  const computedBuf = Buffer.from(computed, "hex");

  if (hashBuf.length !== computedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(hashBuf, computedBuf);
}

export function isValidOTPFormat(otp: string): boolean {
  const otpPattern = new RegExp(`^\\d{${OTP_LENGTH}}$`);
  return otpPattern.test(otp);
}

export function getOTPExpiration(): Date {
  return new Date(Date.now() + OTP_EXPIRES_SECONDS * 1000);
}

export function getLockoutExpiration(): Date {
  return new Date(Date.now() + OTP_LOCKOUT_MINUTES * 60 * 1000);
}

export function getMaxAttempts(): number {
  return OTP_MAX_ATTEMPTS;
}

export function getResendCooldown(): number {
  return OTP_RESEND_COOLDOWN_SECONDS;
}
