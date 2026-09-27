import { timestamp } from "drizzle-orm/pg-core";

/**
 * A row's created/updated time. The database defaults it to now() so a plain
 * SQL insert need not supply one; Drizzle inserts take the caller's clock.
 */
export const rowTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true })
    .notNull()
    .defaultNow()
    .$defaultFn(() => new Date());
