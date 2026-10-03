import { NextResponse } from "next/server";
import { SIGNED_OUT_COOKIE_NAME } from "@/modules/auth/constants";
import { endSession } from "@/modules/auth/server/current-session";
import { signedOutCookieOptions } from "@/modules/auth/server/signed-out-cookie";

export const dynamic = "force-dynamic";

/**
 * Ends this browser's session. It is a route and not a server action on purpose:
 * an action that deletes the cookie also re-renders the page it was called from,
 * and that page would redirect to the sign-in that signs the person straight
 * back in. The marker cookie covers the navigations that can still land on the
 * login page before the caller loads the signed-out screen itself.
 */
export async function POST() {
  await endSession();
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SIGNED_OUT_COOKIE_NAME, "1", signedOutCookieOptions());
  return response;
}
