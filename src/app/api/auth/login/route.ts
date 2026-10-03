import { NextResponse, type NextRequest } from "next/server";
import { runtimeEnv } from "@/lib/env/runtime";
import { logger } from "@/lib/logger";
import { SIGNED_OUT_COOKIE_NAME } from "@/modules/auth/constants";
import { signedOutCookieOptions } from "@/modules/auth/server/signed-out-cookie";
import {
  OIDC_FLOW_COOKIE_NAME,
  oidcFlowCookieOptions,
  startOidcLogin,
} from "@/modules/auth/server/oidc";

export const dynamic = "force-dynamic";

/** Sends the browser to the OIDC provider; an already signed-in provider sends it straight back. */
export async function GET(request: NextRequest) {
  const appUrl = new URL(runtimeEnv.appUrl);
  try {
    const { authorizationUrl, flowCookie } = await startOidcLogin(
      request.nextUrl.searchParams.get("callbackUrl")
    );
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(OIDC_FLOW_COOKIE_NAME, flowCookie, oidcFlowCookieOptions());
    // Signing in again is what the person asked for, so they are no longer "just signed out".
    response.cookies.set(SIGNED_OUT_COOKIE_NAME, "", signedOutCookieOptions(0));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.error(
      {
        errorCode: "OIDC_LOGIN_START_FAILED",
        errorName: error instanceof Error ? error.name : "unknown",
      },
      "OIDC sign-in could not start"
    );
    return NextResponse.redirect(new URL("/login?error=failed", appUrl), {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
