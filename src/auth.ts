import NextAuth, { type NextAuthConfig } from "next-auth";
import { CredentialsSignin } from "@auth/core/errors";
import Credentials from "next-auth/providers/credentials";
import { resolveSupportedLocale } from "@/i18n/resolve-locale";
import { authConfig } from "./auth.config";
import { authenticateWithOTP } from "@/modules/auth/application/use-cases/authenticate-with-otp";
import { authenticateWithPassword } from "@/modules/auth/application/use-cases/authenticate-with-password";
import { authenticateDevUser } from "@/modules/auth/application/use-cases/authenticate-dev-user";
import { getSessionUser } from "@/modules/auth/application/queries/get-session-user";
import { isDevAuthBypassEnabled } from "@/modules/auth/dev-auth";
import { TIME_SECONDS } from "@/lib/constants";
import { runtimeEnv } from "@/lib/env/runtime";
import { serverComposition } from "@/application/server-composition-root";
import { completeInteractiveSignIn } from "@/application/use-cases/complete-interactive-sign-in";
import { AuthSignInError } from "@/modules/auth/errors";
import type { AuthenticatedPrincipal } from "@/modules/auth/contracts";
import { UnauthorizedError } from "@/lib/errors";
import { isCoupleMember } from "@/lib/couple-config";

class AuthCredentialsSigninError extends CredentialsSignin {
  constructor(code: string) {
    super();
    this.code = code;
  }
}

async function completeSignIn(principal: AuthenticatedPrincipal) {
  return completeInteractiveSignIn(principal, {
    ledgers: serverComposition.ledgers,
    otpTokens: serverComposition.otpTokens,
    emailDelivery: serverComposition.email,
  });
}

async function authorizeInteractiveSignIn(
  authenticate: () => Promise<AuthenticatedPrincipal | null>
) {
  try {
    const principal = await authenticate();
    if (principal == null) return null;
    if (!isCoupleMember(principal.id)) return null;
    return await completeSignIn(principal);
  } catch (error) {
    if (error instanceof AuthSignInError) {
      throw new AuthCredentialsSigninError(error.code);
    }
    throw error;
  }
}

const providers: NextAuthConfig["providers"] = [
  Credentials({
    id: "otp",
    name: "OTP",
    credentials: {
      email: { type: "email" },
      otp: { type: "text" },
      locale: { type: "text" },
    },
    async authorize(credentials, request) {
      if (
        credentials?.email == null ||
        credentials.email === "" ||
        credentials?.otp == null ||
        credentials.otp === ""
      ) {
        return null;
      }

      if (typeof credentials.email !== "string" || typeof credentials.otp !== "string") {
        return null;
      }
      const email = credentials.email;
      const otp = credentials.otp;

      return authorizeInteractiveSignIn(() =>
        authenticateWithOTP(
          {
            email,
            otp,
            locale: resolveSupportedLocale({
              explicitLocale: typeof credentials.locale === "string" ? credentials.locale : null,
            }),
            requestHeaders: request.headers,
          },
          {
            userAccounts: serverComposition.userAccounts,
            otpTokens: serverComposition.otpTokens,
            rateLimiter: serverComposition.rateLimiter,
          }
        )
      );
    },
  }),
  Credentials({
    id: "password",
    name: "Password",
    credentials: {
      email: { type: "email" },
      password: { type: "password" },
      locale: { type: "text" },
    },
    async authorize(credentials, request) {
      if (typeof credentials?.email !== "string" || typeof credentials.password !== "string") {
        return null;
      }
      const email = credentials.email;
      const password = credentials.password;
      return authorizeInteractiveSignIn(() =>
        authenticateWithPassword(
          {
            email,
            password,
            locale: resolveSupportedLocale({
              explicitLocale: typeof credentials.locale === "string" ? credentials.locale : null,
            }),
            requestHeaders: request.headers,
          },
          {
            users: serverComposition.userAccounts,
            rateLimiter: serverComposition.rateLimiter,
          }
        )
      );
    },
  }),
];

if (isDevAuthBypassEnabled()) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Development",
      credentials: {
        locale: { type: "text" },
      },
      async authorize(credentials) {
        return authorizeInteractiveSignIn(() =>
          authenticateDevUser(
            {
              locale: resolveSupportedLocale({
                explicitLocale: typeof credentials?.locale === "string" ? credentials.locale : null,
              }),
            },
            { users: serverComposition.userAccounts }
          )
        );
      },
    })
  );
}

export const authOptions = {
  ...authConfig,
  providers,
  session: {
    strategy: "jwt",
    maxAge: runtimeEnv.sessionMaxAgeDays * TIME_SECONDS.DAY,
    updateAge: TIME_SECONDS.DAY,
  },
  pages: authConfig.pages,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user != null && user.id != null && user.id !== "") {
        token.id = user.id;
        token.sub = user.id;
        token.authVersion = user.authVersion;
        token.authenticatedAt = Math.floor(Date.now() / 1000);
      }
      return token;
    },
    async session({ session, token }) {
      if (token.sub != null && token.sub !== "" && session.user != null) {
        const dbUser = await getSessionUser(token.sub, serverComposition.userAccounts);
        if (!isCoupleMember(dbUser.id)) throw new UnauthorizedError("Account is not a member");
        const tokenAuthVersion =
          typeof token.authVersion === "number" && Number.isInteger(token.authVersion)
            ? token.authVersion
            : 1;
        if (tokenAuthVersion !== dbUser.authVersion) {
          throw new UnauthorizedError("Session has been revoked");
        }
        const authenticatedAt =
          typeof token.authenticatedAt === "number" && Number.isFinite(token.authenticatedAt)
            ? token.authenticatedAt
            : token.iat;
        if (authenticatedAt == null || !Number.isFinite(authenticatedAt)) {
          throw new UnauthorizedError("Session authentication time is missing");
        }
        const authenticatedAtDate = new Date(authenticatedAt * 1000);
        if (!Number.isFinite(authenticatedAtDate.getTime())) {
          throw new UnauthorizedError("Session authentication time is invalid");
        }

        return {
          ...session,
          user: {
            ...session.user,
            id: dbUser.id,
            email: dbUser.email,
            name: dbUser.name,
            image: dbUser.image,
            hasPassword: dbUser.passwordHash != null,
            passwordUpdatedAt: dbUser.passwordUpdatedAt?.toISOString() ?? null,
            interfaceLanguage: dbUser.interfaceLanguage,
            authenticatedAt: authenticatedAtDate.toISOString(),
          },
        };
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authOptions);

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      hasPassword: boolean;
      passwordUpdatedAt: string | null;
      interfaceLanguage: "auto" | "zh" | "en";
      authenticatedAt: string;
    };
  }

  interface User {
    locale?: string | null;
    authVersion: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    authVersion?: number;
    authenticatedAt?: number;
  }
}
