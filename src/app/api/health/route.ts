import { NextResponse } from "next/server";
import { isDatabaseReachable } from "@/server/health";

export const dynamic = "force-dynamic";

/**
 * Whether the process can serve: it answers only when the database does. Public and carries no
 * ledger data, so a container healthcheck can call it without a session.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (await isDatabaseReachable()) return NextResponse.json({ status: "ok" }, { headers });
  return NextResponse.json({ status: "unavailable" }, { status: 503, headers });
}
