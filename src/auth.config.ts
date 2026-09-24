import type { NextAuthConfig } from "next-auth";

// Notice this is only an object, not a full NextAuth instance
export const authConfig = {
  pages: {
    signIn: "/login",
    error: "/login/error",
  },
  callbacks: {
    authorized() {
      // We can move the proxy logic here if we want to simplify src/proxy.ts.
      // The current request handling stays in src/proxy.ts, so this remains permissive.
      return true;
    },
  },
  providers: [], // Providers added in auth.ts
} satisfies NextAuthConfig;
