import { pgTable, text, index, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { rowTimestamp } from "./columns";

/**
 * A signed-in browser. The identity provider decides who may sign in, so a
 * session carries no account: just the address the provider vouched for, to show
 * who is signed in. The cookie carries a random token; only its keyed digest is
 * stored, so a leaked table cannot be replayed. Signing out deletes the row.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    email: text("email"),
    createdAt: rowTimestamp("created_at"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_sessions_token_hash").on(table.tokenHash),
    index("idx_sessions_expires_at").on(table.expiresAt),
  ]
);
