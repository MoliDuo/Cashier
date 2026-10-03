import { NextResponse } from "next/server";
import { runtimeEnv } from "@/lib/env/runtime";
import { isDatabaseReachable } from "@/server/health";

export const dynamic = "force-dynamic";

/**
 * Whether the process can serve, and which commit it was built from: the deploy checks that
 * `version` equals the sha it just shipped. It answers ok only when the database does. Public and
 * carries no ledger data, so a container healthcheck can call it without a session.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  const version = runtimeEnv.appVersion;
  if (await isDatabaseReachable()) return NextResponse.json({ ok: true, version }, { headers });
  return NextResponse.json({ ok: false, version }, { status: 503, headers });
}
