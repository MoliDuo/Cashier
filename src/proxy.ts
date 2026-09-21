import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

/** Paths from when every route carried a locale prefix. */
const LEGACY_LOCALE_PREFIX = /^\/(?:zh|en)(?=\/|$)/;

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // API routes must be classified before dotted static-looking paths.
  if (pathname.startsWith("/api/")) {
    const isPublicApi =
      pathname === "/api/auth" ||
      pathname.startsWith("/api/auth/") ||
      pathname.startsWith("/api/v1/");

    if (!isPublicApi && !req.auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next") || pathname.includes(".")) {
    return NextResponse.next();
  }

  // A bookmark or an installed home-screen shortcut still points at /zh/...
  if (LEGACY_LOCALE_PREFIX.test(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = pathname.replace(LEGACY_LOCALE_PREFIX, "") || "/";
    return NextResponse.redirect(url);
  }

  // Auth protection for pages is handled by the (protected) layout.
  return NextResponse.next();
});

export const config = {
  // Matcher ignoring static files
  matcher: ["/api/:path*", "/((?!_next|.*\\..*).*)"],
};
