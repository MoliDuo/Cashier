import { isIP } from "node:net";
import { runtimeEnv } from "@/lib/env/runtime";

export type HeadersLike = Pick<Headers, "get">;

/**
 * The client address a reverse proxy wrote into `X-Real-IP`.
 *
 * The header is trusted only when `TRUSTED_PROXY=proxy` says the proxy overwrites it, and it must
 * hold exactly one valid address; anything else is the shared "unknown" bucket.
 */
export function getClientIPFromHeaders(headersList: HeadersLike): string {
  if (runtimeEnv.trustedProxy !== "proxy") return "unknown";
  const value = headersList.get("x-real-ip")?.trim() ?? "";
  if (value !== "" && !value.includes(",") && isIP(value) !== 0) return value;
  return "unknown";
}
