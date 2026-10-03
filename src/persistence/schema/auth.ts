import {
  pgTable,
  text,
  foreignKey,
  index,
  timestamp,
  uniqueIndex,
  uuid,
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
 * The addresses that sign in to the one account: whoever the identity provider
 * knows by one of them gets in. The provider vouches for an address, so a row
 * needs no verification of its own, and the account keeps at least one.
 */
export const loginEmails = pgTable(
  "login_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    email: text("email").notNull(),
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
