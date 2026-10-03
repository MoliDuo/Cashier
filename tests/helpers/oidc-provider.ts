import type { AddressInfo } from "node:net";
import { http, passthrough } from "msw";
import { afterAll, beforeAll, beforeEach } from "vitest";
import {
  createSmokeOidcServer,
  type SmokeOidcProvider,
  type SmokeOidcUser,
} from "../../scripts/smoke-oidc-server";
import { testNetwork } from "../setup.network";

/**
 * Runs the smoke run's OIDC provider on a loopback port for one test file and
 * points the app's `OIDC_*` settings at it. Only the provider is real HTTP; the
 * app's client, state handling and database are the production code.
 */
export function startOidcProviderForTests() {
  const clientId = "cashier-test";
  const clientSecret = "cashier-test-secret";
  const provider: SmokeOidcProvider = createSmokeOidcServer({ clientId, clientSecret });
  const saved = {
    issuer: process.env.OIDC_ISSUER_URL,
    id: process.env.OIDC_CLIENT_ID,
    secret: process.env.OIDC_CLIENT_SECRET,
  };
  let issuer = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => provider.server.listen(0, "127.0.0.1", resolve));
    issuer = `http://127.0.0.1:${(provider.server.address() as AddressInfo).port}`;
    process.env.OIDC_ISSUER_URL = issuer;
    process.env.OIDC_CLIENT_ID = clientId;
    process.env.OIDC_CLIENT_SECRET = clientSecret;
  });

  beforeEach(() => {
    testNetwork.use(http.all(/^http:\/\/127\.0\.0\.1:\d+\/.*/, () => passthrough()));
    provider.signInAs(null);
  });

  afterAll(async () => {
    process.env.OIDC_ISSUER_URL = saved.issuer;
    process.env.OIDC_CLIENT_ID = saved.id;
    process.env.OIDC_CLIENT_SECRET = saved.secret;
    await new Promise<void>((resolve) => provider.server.close(() => resolve()));
  });

  return {
    signInAs: (user: SmokeOidcUser | null) => provider.signInAs(user),
    /**
     * What the browser does between the two redirects: follows the app's
     * authorization URL to the provider and returns where it sends the browser back.
     */
    async authorize(authorizationUrl: URL): Promise<URLSearchParams> {
      const response = await fetch(authorizationUrl, { redirect: "manual" });
      return new URL(response.headers.get("location") ?? "").searchParams;
    },
  };
}
