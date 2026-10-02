import { UnauthorizedError } from "@/lib/errors";
import { getInsight } from "@/lib/telemetry/server";
import { requireAuth } from "@/modules/auth/server/session-guards";

export const dynamic = "force-dynamic";

/** Whether a signed-in account sent this; anything else is the platform's 401, not an error. */
async function isSignedIn(): Promise<boolean> {
  try {
    await requireAuth();
    return true;
  } catch (error) {
    if (error instanceof UnauthorizedError) return false;
    throw error;
  }
}

/**
 * The browser SDK's relay to MoliInsight. The ingest key stays here: the browser
 * posts to this same-origin route, which checks the session and forwards the
 * batch. With INSIGHT_URL or INSIGHT_KEY unset it answers 204 and forwards
 * nothing, so telemetry is a no-op rather than an error.
 */
export function POST(request: Request): Promise<Response> {
  return getInsight().relayHandler({ authorize: isSignedIn })(request);
}
