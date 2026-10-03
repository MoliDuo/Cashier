import "server-only";
import crypto from "node:crypto";
import * as client from "openid-client";
import { runtimeEnv } from "@/lib/env/runtime";
import { logger } from "@/lib/logger";
import { keyedDigest } from "@/lib/security/keys";
import { sanitizeCallbackPath } from "../domain/callback-path";

/** The cookie that carries one sign-in attempt from the redirect out to the one back. */
export const OIDC_FLOW_COOKIE_NAME = "cashier_oidc";
const OIDC_CALLBACK_PATH = "/auth/callback";
/** The provider has this long to send the browser back. */
const OIDC_FLOW_MAX_AGE_SECONDS = 10 * 60;

/**
 * Cookie attributes for the flow cookie; `maxAge: 0` with the same path clears it. The path is the
 * callback's, so the cookie goes nowhere else.
 */
export function oidcFlowCookieOptions(maxAgeSeconds = OIDC_FLOW_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: new URL(runtimeEnv.appUrl).protocol === "https:",
    sameSite: "lax" as const,
    path: OIDC_CALLBACK_PATH,
    maxAge: maxAgeSeconds,
  };
}

const SCOPE = "openid profile email groups";
/** How far an ID token's `iat` may be from now. */
const ID_TOKEN_MAX_AGE_SECONDS = 5 * 60;
const CONFIGURATION_TTL_MS = 60 * 60 * 1000;

interface FlowState {
  state: string;
  nonce: string;
  verifier: string;
  callbackPath: string;
  expiresAt: number;
}

export interface OidcLoginStart {
  authorizationUrl: URL;
  /** The value for the `cashier_oidc` cookie. */
  flowCookie: string;
}

export type OidcCompletion =
  | { status: "authenticated"; email: string; callbackPath: string }
  | { status: "denied" }
  | { status: "failed" };

let cachedConfiguration: {
  key: string;
  expiresAt: number;
  value: Promise<client.Configuration>;
} | null = null;

function isLoopback(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/**
 * The provider's discovered endpoints, kept for an hour. A failed discovery is
 * not kept, so a provider that was down when the app started is found again.
 */
async function getConfiguration(now = Date.now()): Promise<client.Configuration> {
  const issuer = new URL(runtimeEnv.oidcIssuerUrl);
  const key = [issuer.href, runtimeEnv.oidcClientId, runtimeEnv.oidcClientSecret].join("\0");
  if (cachedConfiguration?.key === key && cachedConfiguration.expiresAt > now) {
    return cachedConfiguration.value;
  }
  const value = client.discovery(
    issuer,
    runtimeEnv.oidcClientId,
    // Only RS256 is accepted for the ID token, whatever the provider's metadata lists.
    { id_token_signed_response_alg: "RS256" },
    client.ClientSecretPost(runtimeEnv.oidcClientSecret),
    // Plain http is for a provider on this machine only (tests, local development).
    {
      execute:
        issuer.protocol === "http:" && isLoopback(issuer) ? [client.allowInsecureRequests] : [],
    }
  );
  const entry = { key, expiresAt: now + CONFIGURATION_TTL_MS, value };
  cachedConfiguration = entry;
  value.catch(() => {
    if (cachedConfiguration === entry) cachedConfiguration = null;
  });
  return value;
}

function redirectUri(): URL {
  return new URL(OIDC_CALLBACK_PATH, runtimeEnv.appUrl);
}

function sealFlow(flow: FlowState): string {
  const payload = Buffer.from(JSON.stringify(flow)).toString("base64url");
  return `${payload}.${keyedDigest("oidc-flow", payload)}`;
}

function unsealFlow(cookie: string | undefined, now: number): FlowState | null {
  if (cookie == null) return null;
  const [payload, signature, ...rest] = cookie.split(".");
  if (payload == null || signature == null || rest.length > 0) return null;
  const expected = Buffer.from(keyedDigest("oidc-flow", payload));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const flow = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as Partial<FlowState>;
    if (
      typeof flow.state !== "string" ||
      typeof flow.nonce !== "string" ||
      typeof flow.verifier !== "string" ||
      typeof flow.callbackPath !== "string" ||
      typeof flow.expiresAt !== "number" ||
      flow.expiresAt <= now
    ) {
      return null;
    }
    return flow as FlowState;
  } catch {
    return null;
  }
}

/** Starts one sign-in: the provider's authorization URL and the cookie that remembers it. */
export async function startOidcLogin(
  callbackPath: string | null,
  now = Date.now()
): Promise<OidcLoginStart> {
  const configuration = await getConfiguration(now);
  const flow: FlowState = {
    state: client.randomState(),
    nonce: client.randomNonce(),
    verifier: client.randomPKCECodeVerifier(),
    callbackPath: sanitizeCallbackPath(callbackPath),
    expiresAt: now + OIDC_FLOW_MAX_AGE_SECONDS * 1000,
  };
  const authorizationUrl = client.buildAuthorizationUrl(configuration, {
    redirect_uri: redirectUri().href,
    scope: SCOPE,
    response_type: "code",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: await client.calculatePKCECodeChallenge(flow.verifier),
    code_challenge_method: "S256",
  });
  return { authorizationUrl, flowCookie: sealFlow(flow) };
}

/**
 * Finishes a sign-in from what the provider sent back: checks state, PKCE, nonce
 * and the ID token's signature, issuer, audience and age, and reads the address the
 * provider vouches for. The address must be in the ID token itself (the provider's
 * claims policy puts it there); userinfo is never a substitute for a verified token.
 */
export async function completeOidcLogin(input: {
  query: URLSearchParams;
  flowCookie: string | undefined;
  now?: number;
}): Promise<OidcCompletion> {
  const now = input.now ?? Date.now();
  const flow = unsealFlow(input.flowCookie, now);
  if (flow == null) return { status: "failed" };
  if (input.query.get("error") === "access_denied") return { status: "denied" };

  try {
    const configuration = await getConfiguration(now);
    const currentUrl = redirectUri();
    currentUrl.search = input.query.toString();
    const tokens = await client.authorizationCodeGrant(configuration, currentUrl, {
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      pkceCodeVerifier: flow.verifier,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (claims == null) return { status: "failed" };

    const nowSeconds = Math.floor(now / 1000);
    if (
      typeof claims.iat !== "number" ||
      nowSeconds - claims.iat > ID_TOKEN_MAX_AGE_SECONDS ||
      claims.iat - nowSeconds > ID_TOKEN_MAX_AGE_SECONDS
    ) {
      return { status: "failed" };
    }

    const { email, email_verified: emailVerified } = claims;
    if (typeof email !== "string" || email.trim() === "" || emailVerified === false) {
      return { status: "failed" };
    }
    return { status: "authenticated", email: email.trim(), callbackPath: flow.callbackPath };
  } catch (error) {
    // The error names what failed in the exchange; it never carries the code or a token.
    logger.warn(
      {
        errorCode: "OIDC_EXCHANGE_FAILED",
        errorName: error instanceof Error ? error.name : "unknown",
      },
      "OIDC sign-in could not be completed"
    );
    return { status: "failed" };
  }
}
