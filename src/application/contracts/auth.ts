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
  release(input: { email: string; tokenHash: string }): Promise<void>;
  consume(input: { email: string; tokenHash: string }): Promise<boolean>;
  discard(input: { email: string; tokenHash: string }): Promise<boolean>;
}

/**
 * The one account. `email` is the address the caller signed in with or, for a
 * lookup by id, the account's first login address — never the only one it has.
 */
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

/**
 * First-run setup. It is the only contract that reads and writes the account
 * without a session, so it stays deliberately small: "is the instance empty"
 * and "create the whole initial state atomically".
 */
export interface SetupContract {
  bookNames: readonly string[];
  email: string;
  password: string;
  locale: string;
}

export interface SetupPort {
  isPending(): Promise<boolean>;
  /**
   * The pending setup code, issuing one when none exists or the stored one has
   * expired. `created` tells the caller to print it: only the call that issued
   * it knows the plaintext.
   */
  getOrCreateCode(): Promise<{ code: string; created: boolean; issuedAt: Date | null }>;
  /**
   * Constant-time comparison against the stored hash, counting failures. Once
   * the attempts are used up the code is retired, so a fresh one is issued and
   * printed on the next visit instead of the guess being retried forever.
   */
  verifyCode(code: string): Promise<SetupCodeVerdict>;
  createInitialAccount(input: SetupContract): Promise<{ userId: string; ledgerId: string }>;
}

/**
 * `mismatch` is a wrong code that still has attempts left; `locked_out` means
 * this guess used the last one and retired the code; `expired` means the stored
 * code is past its lifetime, so a new one has to be issued and printed.
 */
export type SetupCodeVerdict = "accepted" | "mismatch" | "locked_out" | "expired";

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
