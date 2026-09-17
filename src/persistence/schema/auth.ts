import {
  pgTable,
  text,
  integer,
  index,
  timestamp,
  uniqueIndex,
  jsonb,
  uuid,
  inet,
  check,
} from "drizzle-orm/pg-core";
import { sql, type InferSelectModel } from "drizzle-orm";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name"),
    /** What the partner sees: 我 / 对方 are labelled from this, never from email. */
    nickname: text("nickname").notNull(),
    gender: text("gender").notNull(),
    /** Null means automatic: the device's own zone decides the day. */
    timeZone: text("time_zone"),
    email: text("email").notNull(),
    emailVerified: timestamp("email_verified", { withTimezone: true }),
    image: text("image"),
    passwordHash: text("password_hash"),
    passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }),
    authVersion: integer("auth_version").notNull().default(1),
    preferences: jsonb("preferences")
      .$type<UserPreferences>()
      .notNull()
      .default({ interfaceLanguage: "auto" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check("ck_users_auth_version_positive", sql`${table.authVersion} > 0`),
    check("ck_users_nickname_length", sql`length(btrim(${table.nickname})) BETWEEN 1 AND 20`),
    check("ck_users_gender", sql`${table.gender} IN ('male', 'female')`),
    check(
      "ck_users_time_zone_length",
      sql`${table.timeZone} IS NULL OR length(${table.timeZone}) <= 50`
    ),
    uniqueIndex("uniq_users_active_email")
      .on(sql`lower(${table.email})`)
      .where(sql`${table.deletedAt} IS NULL`),
  ]
);

export type User = InferSelectModel<typeof users>;

export type InterfaceLanguage = "auto" | "zh" | "en";

export interface UserPreferences {
  interfaceLanguage: InterfaceLanguage;
}

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
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ipAddress: inet("ip_address"),
  },
  (table) => [
    uniqueIndex("uniq_otp_tokens_email").on(table.email),
    index("idx_otp_tokens_expires").on(table.expires),
    index("idx_otp_tokens_verified").on(table.email, table.verifiedAt),
  ]
);

export type OTPToken = InferSelectModel<typeof otpTokens>;

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
