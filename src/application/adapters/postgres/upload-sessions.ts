import { and, isNull, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { runtimeEnv } from "@/lib/env/runtime";
import { ledgers, uploadSessionFiles, uploadSessions } from "@/persistence";

interface CreateUploadSessionInput {
  id: string;
  ledgerId: string;
  finalizationTokenHash: string;
  transport: "proxy" | "direct";
  expiresAt: Date;
  createdAt: Date;
  targets: readonly {
    id: string;
    position: number;
    contentType: string;
    byteSize: number;
    originalFilename: string | null;
    checksum: string | null;
  }[];
}

export interface UploadSessionRepository {
  create(input: CreateUploadSessionInput): Promise<void>;
  find(id: string): Promise<typeof uploadSessions.$inferSelect | null>;
}

export const postgresUploadSessionRepository: UploadSessionRepository = {
  async create(input) {
    await db.transaction(async (tx) => {
      const ledger = await tx
        .select({ id: ledgers.id })
        .from(ledgers)
        .where(and(eq(ledgers.id, input.ledgerId), isNull(ledgers.deletedAt)))
        .for("update")
        .then((rows) => rows[0]);
      if (ledger == null) throw new NotFoundError("Ledger");
      const fifteenMinutesAgo = new Date(input.createdAt.getTime() - 15 * 60 * 1000);
      const utcDayStart = new Date(input.createdAt);
      utcDayStart.setUTCHours(0, 0, 0, 0);
      const recentPlans = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.ledgerId, input.ledgerId),
            gte(uploadSessions.createdAt, fifteenMinutesAgo)
          )
        )
        .then((rows) => rows[0]?.count ?? 0);
      const openSessions = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.ledgerId, input.ledgerId),
            inArray(uploadSessions.status, ["open", "finalizing"])
          )
        )
        .then((rows) => rows[0]?.count ?? 0);
      const dailyBytes = await tx
        .select({
          bytes: sql<number>`coalesce(sum(${uploadSessionFiles.expectedByteSize}), 0)::bigint`,
        })
        .from(uploadSessionFiles)
        .innerJoin(uploadSessions, eq(uploadSessions.id, uploadSessionFiles.uploadSessionId))
        .where(
          and(
            eq(uploadSessions.ledgerId, input.ledgerId),
            gte(uploadSessions.createdAt, utcDayStart),
            inArray(uploadSessions.status, ["open", "finalizing", "finalized"])
          )
        )
        .then((rows) => Number(rows[0]?.bytes ?? 0));
      const reservedBytes = input.targets.reduce((sum, target) => sum + target.byteSize, 0);
      if (
        recentPlans >= runtimeEnv.uploadPlanLimitPer15Min ||
        openSessions >= runtimeEnv.uploadOpenSessionLimit ||
        dailyBytes + reservedBytes > runtimeEnv.uploadDailyBytesLimit
      ) {
        throw new AppError("Upload quota exceeded", "UPLOAD_QUOTA_EXCEEDED", 429);
      }
      await tx.insert(uploadSessions).values({
        id: input.id,
        ledgerId: input.ledgerId,
        finalizationTokenHash: input.finalizationTokenHash,
        transport: input.transport,
        status: "open",
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
      });
      if (input.targets.length > 0) {
        await tx.insert(uploadSessionFiles).values(
          input.targets.map((target) => ({
            ledgerId: input.ledgerId,
            uploadSessionId: input.id,
            targetId: target.id,
            position: target.position,
            expectedContentType: target.contentType,
            expectedByteSize: target.byteSize,
            originalFilename: target.originalFilename,
            expectedChecksum: target.checksum,
            status: "planned" as const,
          }))
        );
      }
    });
  },
  async find(id) {
    return (await db.query.uploadSessions.findFirst({ where: eq(uploadSessions.id, id) })) ?? null;
  },
};
