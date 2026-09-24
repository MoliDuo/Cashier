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
    bookId: string
  ): Promise<CreatedServiceCredentialContract>;
  /**
   * Rebinds a live key to another book; uploads follow it immediately. Throws
   * `NotFoundError` for a missing key and `ConflictError` for a book outside the
   * ledger, so the result is never null.
   */
  setBook(
    ledgerId: LedgerId,
    credentialId: string,
    bookId: string
  ): Promise<ServiceCredentialContract>;
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
  /**
   * Spend the token. Returns false if it was already spent, has expired, is
   * locked out, or has run out of attempts — the same conditions the caller
   * checked a moment ago, re-checked here so that two simultaneous verifies
   * cannot both win.
   */
  consume(input: {
    email: string;
    tokenHash: string;
    now: Date;
    maxAttempts: number;
  }): Promise<boolean>;
  discard(input: { email: string; tokenHash: string }): Promise<boolean>;
}

/**
 * The one account. `email` is the address the caller signed in with or, for a
 * lookup by id, the account's first login address — never the only one it has.
 */
interface UserAccountContract {
  id: string;
  email: string;
  passwordHash: string | null;
  passwordUpdatedAt: Date | null;
  authVersion: number;
}

export interface LoginEmailContract {
  email: string;
  emailVerifiedAt: string | null;
}

export interface UserAccountPort {
  /** `email` is one of the account's login addresses. */
  findByEmail(email: string): Promise<UserAccountContract | null>;
  findById(id: string): Promise<UserAccountContract | null>;
  /** The account's login addresses, oldest first. */
  listLoginEmails(userId: string): Promise<readonly LoginEmailContract[]>;
}
