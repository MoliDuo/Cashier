import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  foreignKey,
  index,
  timestamp,
  uniqueIndex,
  uuid,
  check,
} from "drizzle-orm/pg-core";
import { sql, type InferSelectModel } from "drizzle-orm";
import { rowTimestamp } from "./columns";

/**
 * The single account that owns the app. One row, no per-person columns: the
 * login addresses live in `login_emails`, and what used to be "whose records
 * these are" is now the `book_id` on each record.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: rowTimestamp("created_at"),
  updatedAt: rowTimestamp("updated_at"),
});

export type User = InferSelectModel<typeof users>;

/**
 * The addresses that sign in to the one account. An address is added by
 * verifying an OTP sent to it, so every row records when it was verified, and
 * the account keeps at least one.
 */
export const loginEmails = pgTable(
  "login_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    email: text("email").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_login_emails_user",
    }).onDelete("cascade"),
    uniqueIndex("uq_login_emails_email").on(sql`lower(${table.email})`),
    index("idx_login_emails_user_id").on(table.userId),
  ]
);

export type LoginEmail = InferSelectModel<typeof loginEmails>;

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
    userId: uuid("user_id").notNull(),
    createdAt: rowTimestamp("created_at"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    authenticatedAt: timestamp("authenticated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_sessions_user",
    }).onDelete("cascade"),
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
    userId: uuid("user_id").notNull(),
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    name: text("name").notNull(),
    createdAt: rowTimestamp("created_at"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_passkeys_user",
    }).onDelete("cascade"),
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
    userId: uuid("user_id"),
    purpose: text("purpose").notNull(),
    challenge: text("challenge").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: rowTimestamp("created_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_webauthn_challenges_user",
    }).onDelete("cascade"),
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

/**
 * The one-time code emailed to sign in, one per address. The code is stored
 * only as a salted keyed hash.
 */
export const signInChallenges = pgTable(
  "sign_in_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: rowTimestamp("created_at"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_sign_in_challenges_email").on(table.email),
    index("idx_sign_in_challenges_expires_at").on(table.expiresAt),
  ]
);

export type SignInChallenge = InferSelectModel<typeof signInChallenges>;

/**
 * A pending "add this address to the account" verification. `email` is not a
 * login address until the OTP sent to it is confirmed.
 */
export const loginEmailChallenges = pgTable(
  "login_email_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: rowTimestamp("created_at"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_login_email_challenges_user",
    }).onDelete("cascade"),
    uniqueIndex("uq_login_email_challenges_user").on(table.userId),
    index("idx_login_email_challenges_expires_at").on(table.expiresAt),
  ]
);
