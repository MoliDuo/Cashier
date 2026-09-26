import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  index,
  timestamp,
  uniqueIndex,
  uuid,
  check,
} from "drizzle-orm/pg-core";
import { sql, type InferSelectModel } from "drizzle-orm";

/**
 * The single account that owns the app. One row, no per-person columns: the
 * login addresses live in `login_emails`, and what used to be "whose records
 * these are" is now the `book_id` on each record.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type User = InferSelectModel<typeof users>;

/**
 * The addresses that sign in to the one account. An address is added by
 * verifying an OTP sent to it, and the account keeps at least one. `email_verified`
 * is null only for a row created before its OTP is confirmed.
 */
export const loginEmails = pgTable(
  "login_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    emailVerified: timestamp("email_verified", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("uniq_login_emails_email").on(sql`lower(${table.email})`),
    index("idx_login_emails_user_id").on(table.userId),
  ]
);

export type LoginEmail = InferSelectModel<typeof loginEmails>;

/**
 * The first-run setup code, while setup is pending. A table rather than process
 * state because a production build renders `/setup` and runs its server action
 * in separate realms; the boolean primary key can only be true, so at most one
 * row exists, and the wizard deletes it as part of creating the account.
 *
 * The row is also the code's clock and its lockout counter: `created_at` dates
 * the code so a log line nobody read cannot lock the instance forever, and
 * `failed_attempts` retires a code that is being guessed at.
 */
export const setupState = pgTable(
  "setup_state",
  {
    id: boolean("id").primaryKey().default(true),
    codeHash: text("code_hash").notNull(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    check("ck_setup_state_single_row", sql`${table.id}`),
    check("ck_setup_state_failed_attempts", sql`${table.failedAttempts} >= 0`),
  ]
);

export type SetupState = InferSelectModel<typeof setupState>;

/**
 * A signed-in browser. The cookie carries a random token; only its keyed digest
 * is stored, so a leaked table cannot be replayed. Signing out, or anything that
 * must end every session, deletes rows.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    authenticatedAt: timestamp("authenticated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_sessions_token_hash").on(table.tokenHash),
    index("idx_sessions_user_id").on(table.userId),
    index("idx_sessions_expires_at").on(table.expiresAt),
  ]
);

/**
 * A WebAuthn credential that signs in to the account. `id` is the credential id
 * the authenticator chose (base64url) and `public_key` its COSE public key
 * (base64url). `counter` rejects a cloned authenticator replaying an old value.
 */
export const passkeys = pgTable(
  "passkeys",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_passkeys_user_id").on(table.userId),
    check("ck_passkeys_counter", sql`${table.counter} >= 0`),
  ]
);

export type Passkey = InferSelectModel<typeof passkeys>;

/**
 * A one-time WebAuthn challenge, consumed by the ceremony that finishes it.
 * `user_id` is null for a sign-in, where the browser has not said who it is.
 */
export const webauthnChallenges = pgTable(
  "webauthn_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    challenge: text("challenge").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_webauthn_challenges_expires_at").on(table.expiresAt),
    check(
      "ck_webauthn_challenges_purpose",
      sql`${table.purpose} IN ('register', 'login', 'enroll')`
    ),
    check(
      "ck_webauthn_challenges_user",
      sql`(${table.purpose} = 'login') = (${table.userId} IS NULL)`
    ),
  ]
);

export const otpTokens = pgTable(
  "otp_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uniq_otp_tokens_email").on(table.email),
    index("idx_otp_tokens_expires").on(table.expires),
  ]
);

export type OTPToken = InferSelectModel<typeof otpTokens>;

/**
 * A pending "add this address to the account" verification. `new_email` is not
 * a login address until the OTP sent to it is confirmed.
 */
export const emailChangeChallenges = pgTable(
  "email_change_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    newEmail: text("new_email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uniq_email_change_challenge_user").on(table.userId),
    index("idx_email_change_challenge_expires").on(table.expiresAt),
  ]
);
