import type {
  AuthenticatedServiceCredentialContract,
  CreatedServiceCredentialContract,
  ServiceCredentialContract,
} from "./ledger";
import type { LedgerId } from "./source-documents";
export interface ServiceCredentialPort {
  authenticate(key: string): Promise<AuthenticatedServiceCredentialContract | null>;
  list(ledgerId: LedgerId): Promise<readonly ServiceCredentialContract[]>;
  create(
    ledgerId: LedgerId,
    name: string,
    userId: string
  ): Promise<CreatedServiceCredentialContract>;
  revoke(
    ledgerId: LedgerId,
    credentialId: string
  ): Promise<"revoked" | "already_revoked" | "not_found">;
}
export interface RateLimitResult {
  success: boolean;
  remaining: number;
  /** Unix timestamp in milliseconds when the current fixed window resets. */
  resetTime: number;
}

export interface RateLimiterPort {
  increment(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
  releaseIncrement(key: string, windowSeconds: number, resetTime: number): Promise<void>;
  /** Read-only count for the current fixed window; 0 when missing or expired. */
  current(key: string, windowSeconds: number): Promise<number>;
  acquireCooldown(
    key: string,
    seconds: number
  ): Promise<{ acquired: boolean; acquiredAt: Date; retryAfter: number }>;
  releaseCooldown(key: string, acquiredAt: Date): Promise<boolean>;
}

export interface EmailDeliveryPort {
  send(input: {
    from: string;
    to: string;
    subject: string;
    content: unknown;
  }): Promise<"sent" | "not_configured">;
}

export interface OtpTokenContract {
  email: string;
  tokenHash: string;
  expiresAt: Date;
  attempts: number;
  lockedUntil: Date | null;
  verifiedAt: Date | null;
}

export interface OtpTokenPort {
  replace(input: {
    email: string;
    tokenHash: string;
    expiresAt: Date;
    ipAddress?: string;
  }): Promise<void>;
  find(email: string): Promise<OtpTokenContract | null>;
  recordFailure(input: {
    email: string;
    tokenHash: string;
    maxAttempts: number;
    lockedUntil: Date;
  }): Promise<{ attempts: number; lockedUntil: Date | null } | null>;
  claim(input: {
    email: string;
    tokenHash: string;
    now: Date;
    maxAttempts: number;
  }): Promise<boolean>;
  release(input: { email: string; tokenHash: string }): Promise<boolean>;
  consume(input: { email: string; tokenHash: string }): Promise<boolean>;
  discard(input: { email: string; tokenHash: string }): Promise<boolean>;
}

interface UserAccountContract {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  passwordHash: string | null;
  passwordUpdatedAt: Date | null;
  authVersion: number;
  interfaceLanguage: "auto" | "zh" | "en";
}

export interface UserAccountPort {
  findByEmail(email: string): Promise<UserAccountContract | null>;
  findById(id: string): Promise<UserAccountContract | null>;
}

export interface UserPreferencesContract {
  interfaceLanguage: "auto" | "zh" | "en";
}

export interface UserPreferencesPort {
  get(userId: string): Promise<UserPreferencesContract | null>;
  update(input: {
    userId: string;
    preferences: UserPreferencesContract;
  }): Promise<UserPreferencesContract | null>;
}

export type MemberGender = "male" | "female";

/**
 * One of the two people sharing a ledger. `nickname` is what the 我 / 对方
 * switch is labelled from; `timeZone` is their own zone, null meaning
 * automatic.
 */
export interface MemberProfileContract {
  id: string;
  nickname: string;
  gender: MemberGender;
  timeZone: string | null;
}

export interface MemberProfileUpdateContract {
  nickname: string;
  gender: MemberGender;
  timeZone: string | null;
}

export interface UserProfilePort {
  /** The two configured members, owner first, or an empty list when unconfigured. */
  listMembers(): Promise<readonly MemberProfileContract[]>;
  /** Updates the signed-in member's own row and nothing else. */
  updateProfile(input: {
    userId: string;
    profile: MemberProfileUpdateContract;
  }): Promise<MemberProfileContract | null>;
}
