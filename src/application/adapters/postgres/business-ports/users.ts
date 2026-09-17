import { and, eq, isNull } from "drizzle-orm";
import type { UserAccountPort, UserPreferencesPort } from "@/application/contracts";
import { db } from "@/lib/db";
import { users } from "@/persistence";
import { normalizeUserPreferences } from "@/modules/auth/services/user-preferences";

export const postgresUserAccountAdapter: UserAccountPort = {
  async findByEmail(email) {
    const row = await db.query.users.findFirst({
      where: and(eq(users.email, email), isNull(users.deletedAt)),
      columns: {
        id: true,
        email: true,
        name: true,
        image: true,
        passwordHash: true,
        passwordUpdatedAt: true,
        authVersion: true,
        preferences: true,
      },
    });
    return row == null
      ? null
      : {
          id: row.id,
          email: row.email,
          name: row.name,
          image: row.image,
          passwordHash: row.passwordHash,
          passwordUpdatedAt: row.passwordUpdatedAt,
          authVersion: row.authVersion,
          interfaceLanguage: normalizeUserPreferences(row.preferences).interfaceLanguage,
        };
  },
  async findById(id) {
    const row = await db.query.users.findFirst({
      where: and(eq(users.id, id), isNull(users.deletedAt)),
      columns: {
        id: true,
        email: true,
        name: true,
        image: true,
        passwordHash: true,
        passwordUpdatedAt: true,
        authVersion: true,
        preferences: true,
      },
    });
    return row == null
      ? null
      : {
          id: row.id,
          email: row.email,
          name: row.name,
          image: row.image,
          passwordHash: row.passwordHash,
          passwordUpdatedAt: row.passwordUpdatedAt,
          authVersion: row.authVersion,
          interfaceLanguage: normalizeUserPreferences(row.preferences).interfaceLanguage,
        };
  },
};

export const postgresUserPreferencesAdapter: UserPreferencesPort = {
  async get(userId) {
    const row = await db.query.users.findFirst({
      where: and(eq(users.id, userId), isNull(users.deletedAt)),
      columns: { preferences: true },
    });
    return row == null ? null : normalizeUserPreferences(row.preferences);
  },

  async update(input) {
    const updated = await db
      .update(users)
      .set({ preferences: input.preferences, updatedAt: new Date() })
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
      .returning({ preferences: users.preferences })
      .then((rows) => rows[0]);
    return updated == null ? null : normalizeUserPreferences(updated.preferences);
  },
};
