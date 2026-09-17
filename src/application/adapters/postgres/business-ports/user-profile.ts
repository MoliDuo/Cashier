import { and, eq, isNull, or } from "drizzle-orm";
import type { MemberProfileContract, UserProfilePort } from "@/application/contracts";
import { db } from "@/lib/db";
import { users } from "@/persistence";
import { getCoupleConfig } from "@/lib/couple-config";

type ProfileRow = Pick<typeof users.$inferSelect, "id" | "nickname" | "gender" | "timeZone">;

function toMemberProfile(row: ProfileRow): MemberProfileContract {
  return {
    id: row.id,
    nickname: row.nickname,
    gender: row.gender === "female" ? "female" : "male",
    timeZone: row.timeZone,
  };
}

export const postgresUserProfileAdapter: UserProfilePort = {
  async listMembers() {
    const config = getCoupleConfig();
    if (config == null) return [];
    const rows = await db.query.users.findMany({
      where: and(
        isNull(users.deletedAt),
        or(eq(users.id, config.ownerId), eq(users.id, config.partnerId))
      ),
      columns: { id: true, nickname: true, gender: true, timeZone: true },
    });
    // Ordered by the configuration, not by the query: 我 / 对方 must not swap
    // places because a nickname or a timestamp changed.
    const byId = new Map(rows.map((row) => [row.id, row]));
    const owner = byId.get(config.ownerId);
    const partner = byId.get(config.partnerId);
    return [owner, partner].filter((row): row is ProfileRow => row != null).map(toMemberProfile);
  },

  async updateProfile(input) {
    const updated = await db
      .update(users)
      .set({
        nickname: input.profile.nickname,
        gender: input.profile.gender,
        timeZone: input.profile.timeZone,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
      .returning({
        id: users.id,
        nickname: users.nickname,
        gender: users.gender,
        timeZone: users.timeZone,
      })
      .then((rows) => rows[0]);
    return updated == null ? null : toMemberProfile(updated);
  },
};
