/**
 * The OIDC provider the production smoke run and the sign-in tests talk to.
 *
 * `npm run test:smoke` boots the real production server, so the sign-in the
 * specs exercise cannot be replaced with an in-process fake the way unit tests
 * do it. This is a provider instead: a real HTTP endpoint with discovery, a
 * JWKS, an authorization endpoint that answers at once, a token endpoint that
 * checks the client secret and the PKCE verifier, and userinfo. The app's own
 * client code runs against it unchanged.
 *
 * There is no login form. `signInAs` says who the provider has signed in: the
 * authorization endpoint then sends the browser straight back with a code for
 * that address, like an identity provider whose user is already signed in, and
 * with `null` it answers `access_denied`. A spec running in another process says
 * the same with `POST /__sign-in-as` and a JSON user, or `null`. The endpoint exists only on loopback
 * and only while the run is up; nothing it handles is logged.
 */

import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

export interface SmokeOidcConfig {
  clientId: string;
  clientSecret: string;
}

export interface SmokeOidcUser {
  email: string;
  /** Whether the address is in the ID token; when false only userinfo has it. */
  emailInIdToken?: boolean;
  /** `undefined` leaves the claim out. */
  emailVerified?: boolean;
  /** Signs a nonce the client did not send, like a replayed response. */
  wrongNonce?: boolean;
}

export interface SmokeOidcProvider {
  server: http.Server;
  signInAs(user: SmokeOidcUser | null): void;
}

interface IssuedCode {
  user: SmokeOidcUser;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
}

const KEY_ID = "smoke-oidc-key";

function json(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readForm(request: http.IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function subjectOf(email: string): string {
  return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
}

export function createSmokeOidcServer(config: SmokeOidcConfig): SmokeOidcProvider {
  let current: SmokeOidcUser | null = null;
  const codes = new Map<string, IssuedCode>();
  const accessTokens = new Map<string, SmokeOidcUser>();
  const keys = generateKeyPair("RS256").then(async (pair) => ({
    privateKey: pair.privateKey,
    jwk: { ...(await exportJWK(pair.publicKey)), kid: KEY_ID, alg: "RS256", use: "sig" } as JWK,
  }));

  const issuerOf = (request: http.IncomingMessage) => `http://${request.headers.host ?? ""}`;

  const authorize = (request: http.IncomingMessage, response: http.ServerResponse, url: URL) => {
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    if (
      url.searchParams.get("client_id") !== config.clientId ||
      redirectUri == null ||
      state == null
    ) {
      return json(response, 400, { error: "invalid_request" });
    }
    const target = new URL(redirectUri);
    target.searchParams.set("state", state);
    if (current == null) {
      target.searchParams.set("error", "access_denied");
    } else {
      const code = randomBytes(16).toString("base64url");
      codes.set(code, {
        user: current,
        nonce: url.searchParams.get("nonce") ?? "",
        codeChallenge: url.searchParams.get("code_challenge") ?? "",
        redirectUri,
      });
      target.searchParams.set("code", code);
    }
    response.writeHead(302, { Location: target.href, "Cache-Control": "no-store" });
    response.end();
  };

  const token = async (request: http.IncomingMessage, response: http.ServerResponse) => {
    const form = await readForm(request);
    if (
      form.get("client_id") !== config.clientId ||
      form.get("client_secret") !== config.clientSecret
    ) {
      return json(response, 401, { error: "invalid_client" });
    }
    const issued = codes.get(form.get("code") ?? "");
    codes.delete(form.get("code") ?? "");
    const verifier = form.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (
      form.get("grant_type") !== "authorization_code" ||
      issued == null ||
      issued.redirectUri !== form.get("redirect_uri") ||
      issued.codeChallenge !== challenge
    ) {
      return json(response, 400, { error: "invalid_grant" });
    }
    const { user } = issued;
    const { privateKey } = await keys;
    const claims: Record<string, unknown> = {
      nonce: user.wrongNonce === true ? "not-the-nonce-that-was-sent" : issued.nonce,
    };
    if (user.emailInIdToken !== false) {
      claims.email = user.email;
      if (user.emailVerified !== undefined) claims.email_verified = user.emailVerified;
    }
    const idToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
      .setIssuer(issuerOf(request))
      .setSubject(subjectOf(user.email))
      .setAudience(config.clientId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const accessToken = randomBytes(24).toString("base64url");
    accessTokens.set(accessToken, user);
    json(response, 200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 300,
      id_token: idToken,
    });
  };

  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", issuerOf(request));
      if (request.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
        const issuer = issuerOf(request);
        return json(response, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          userinfo_endpoint: `${issuer}/userinfo`,
          jwks_uri: `${issuer}/jwks.json`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
          code_challenge_methods_supported: ["S256"],
        });
      }
      if (request.method === "POST" && url.pathname === "/__sign-in-as") {
        const body = Buffer.concat(await Array.fromAsync(request)).toString("utf8");
        current = JSON.parse(body) as SmokeOidcUser | null;
        return json(response, 200, { ok: true });
      }
      if (request.method === "GET" && url.pathname === "/jwks.json") {
        return json(response, 200, { keys: [(await keys).jwk] });
      }
      if (request.method === "GET" && url.pathname === "/authorize") {
        return authorize(request, response, url);
      }
      if (request.method === "POST" && url.pathname === "/token") {
        return token(request, response);
      }
      if (request.method === "GET" && url.pathname === "/userinfo") {
        const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
        const user = bearer == null ? undefined : accessTokens.get(bearer);
        if (user == null) return json(response, 401, { error: "invalid_token" });
        return json(response, 200, {
          sub: subjectOf(user.email),
          email: user.email,
          ...(user.emailVerified === undefined ? {} : { email_verified: user.emailVerified }),
        });
      }
      return json(response, 404, { error: "not_found" });
    })().catch(() => json(response, 500, { error: "server_error" }));
  });

  return {
    server,
    signInAs(user) {
      current = user;
    },
  };
}
