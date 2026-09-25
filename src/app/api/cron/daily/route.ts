import { createHash, timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { runtimeEnv } from "@/lib/env/runtime";
import { logger } from "@/lib/logger";
import { runDailyMaintenance } from "@/server/maintenance/daily";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; compared in constant time. */
function isAuthorized(request: NextRequest, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = runtimeEnv.cronSecret;
  if (secret == null) {
    logger.error("CRON_SECRET is not set; the daily cron cannot run");
    return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  }
  if (!isAuthorized(request, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const steps = await runDailyMaintenance();
  return NextResponse.json({ steps });
}
