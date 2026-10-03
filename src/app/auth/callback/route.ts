import { NextResponse, type NextRequest } from "next/server";
import { runtimeEnv } from "@/lib/env/runtime";
import { logger } from "@/lib/logger";
import { OIDC_FLOW_COOKIE_NAME, oidcFlowCookieOptions } from "@/modules/auth/server/oidc";
import { signInWithOidc, type OidcSignInOutcome } from "@/modules/auth/server/sign-in-with-oidc";

export const dynamic = "force-dynamic";

async function signIn(request: NextRequest): Promise<OidcSignInOutcome> {
  try {
    return await signInWithOidc({
      query: request.nextUrl.searchParams,
      flowCookie: request.cookies.get(OIDC_FLOW_COOKIE_NAME)?.value,
    });
  } catch (error) {
    logger.error(
      {
        errorCode: "OIDC_SIGN_IN_FAILED",
        errorName: error instanceof Error ? error.name : "unknown",
      },
      "OIDC sign-in failed after the provider answered"
    );
    return { status: "failed" };
  }
}

/** Where the provider sends the browser back: opens the session, or says why not. */
export async function GET(request: NextRequest) {
  const appUrl = new URL(runtimeEnv.appUrl);
  const outcome = await signIn(request);
  const target =
    outcome.status === "signed_in"
      ? new URL(outcome.callbackPath, appUrl)
      : new URL(`/login?error=${outcome.status}`, appUrl);
  const response = NextResponse.redirect(target, { headers: { "Cache-Control": "no-store" } });
  // One attempt, one answer: a replayed callback finds no flow to match.
  response.cookies.set(OIDC_FLOW_COOKIE_NAME, "", oidcFlowCookieOptions(0));
  return response;
}
