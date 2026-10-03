import "server-only";
import { runtimeEnv } from "@/lib/env/runtime";

const SIGNED_OUT_MAX_AGE_SECONDS = 60;

/** Cookie attributes for the signed-out marker; `maxAge: 0` with the same path clears it. */
export function signedOutCookieOptions(maxAgeSeconds = SIGNED_OUT_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: new URL(runtimeEnv.appUrl).protocol === "https:",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
