import type { NextAuthConfig } from "next-auth";
import { SESSION_MAX_AGE_DAYS } from "@/config/tuning";
import { TIME_SECONDS } from "@/lib/constants";

/**
 * Settings shared by the full instance in `src/auth.ts` and the lighter one
 * `src/proxy.ts` builds. The proxy re-signs the session cookie on every request
 * it sees, so the session lifetime has to be defined here: an instance without
 * it re-signs with Auth.js's 30-day default instead.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
    error: "/login/error",
  },
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_DAYS * TIME_SECONDS.DAY,
    updateAge: TIME_SECONDS.DAY,
  },
  callbacks: {
    authorized() {
      // Access control lives in src/proxy.ts and the (protected) layout.
      return true;
    },
  },
  providers: [], // Providers added in auth.ts
} satisfies NextAuthConfig;
