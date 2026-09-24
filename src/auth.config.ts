import type { NextAuthConfig } from "next-auth";

// Notice this is only an object, not a full NextAuth instance
export const authConfig = {
  pages: {
    signIn: "/login",
    error: "/login/error",
  },
  callbacks: {
    authorized() {
      // Access control lives in src/proxy.ts and the (protected) layout.
      return true;
    },
  },
  providers: [], // Providers added in auth.ts
} satisfies NextAuthConfig;
