import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { OtpTokenPort } from "@/application/contracts";
import { db } from "@/lib/db";
import { otpTokens } from "@/persistence";

export const postgresOtpTokenAdapter: OtpTokenPort = {
  async replace(input) {
    await db
      .insert(otpTokens)
      .values({
        email: input.email,
        tokenHash: input.tokenHash,
        expires: input.expiresAt,
        ...(input.ipAddress === undefined ? {} : { ipAddress: input.ipAddress }),
      })
      .onConflictDoUpdate({
        target: otpTokens.email,
        set: {
          tokenHash: input.tokenHash,
          expires: input.expiresAt,
          attempts: 0,
          lockedUntil: null,
          lastAttemptAt: null,
          ipAddress: input.ipAddress ?? null,
          createdAt: new Date(),
        },
      });
  },
  async find(email) {
    const row = await db
      .select()
      .from(otpTokens)
      .where(eq(otpTokens.email, email))
      .limit(1)
      .then((rows) => rows[0]);
    return row == null
      ? null
      : {
          email: row.email,
          tokenHash: row.tokenHash,
          expiresAt: row.expires,
          attempts: row.attempts,
          lockedUntil: row.lockedUntil,
        };
  },
  async recordFailure(input) {
    const rows = await db
      .update(otpTokens)
      .set({
        attempts: sql`${otpTokens.attempts} + 1`,
        lastAttemptAt: new Date(),
        lockedUntil: sql`case
          when ${otpTokens.attempts} + 1 >= ${input.maxAttempts} then ${input.lockedUntil}
          else ${otpTokens.lockedUntil}
        end`,
      })
      .where(
        and(
          eq(otpTokens.email, input.email),
          eq(otpTokens.tokenHash, input.tokenHash),
          sql`${otpTokens.attempts} < ${input.maxAttempts}`
        )
      )
      .returning({ attempts: otpTokens.attempts, lockedUntil: otpTokens.lockedUntil });
    return rows[0] ?? null;
  },
  async consume(input) {
    const rows = await db
      .delete(otpTokens)
      .where(
        and(
          eq(otpTokens.email, input.email),
          eq(otpTokens.tokenHash, input.tokenHash),
          sql`${otpTokens.expires} > ${input.now}`,
          sql`${otpTokens.attempts} < ${input.maxAttempts}`,
          or(isNull(otpTokens.lockedUntil), sql`${otpTokens.lockedUntil} <= ${input.now}`)
        )
      )
      .returning({ id: otpTokens.id });
    return rows.length === 1;
  },
  async discard(input) {
    const rows = await db
      .delete(otpTokens)
      .where(and(eq(otpTokens.email, input.email), eq(otpTokens.tokenHash, input.tokenHash)))
      .returning({ id: otpTokens.id });
    return rows.length === 1;
  },
};
