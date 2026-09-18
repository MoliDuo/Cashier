export interface AccountSecurityPort {
  getPasswordHash(userId: string): Promise<string | null | undefined>;
  setInitialPassword(input: {
    userId: string;
    passwordHash: string;
    passwordUpdatedAt: Date;
  }): Promise<boolean>;
  changePassword(input: {
    userId: string;
    expectedPasswordHash: string;
    passwordHash: string;
    passwordUpdatedAt: Date;
  }): Promise<boolean>;
  createEmailChangeChallenge(input: {
    userId: string;
    newEmail: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
    minimumIntervalMs: number;
  }): Promise<"created" | "unauthorized" | "duplicate" | "rate_limited" | "locked">;
  discardEmailChangeChallenge(input: {
    userId: string;
    newEmail: string;
    tokenHash: string;
  }): Promise<void>;
  verifyEmailChangeChallenge(input: {
    userId: string;
    newEmail: string;
    otp: string;
    now: Date;
  }): Promise<
    | { status: "verified"; email: string }
    | { status: "not_found" | "locked" | "expired" | "duplicate" }
    | { status: "incorrect"; attemptsRemaining: number; locked: boolean }
  >;
  /** Removes one login address; `last_email` refuses to leave the account with none. */
  removeLoginEmail(input: {
    userId: string;
    email: string;
    now: Date;
  }): Promise<"removed" | "not_found" | "last_email">;
}
