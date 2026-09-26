import { NextResponse, type NextRequest } from "next/server";
import { SESSION_MAX_AGE_DAYS } from "@/config/tuning";
import { TIME_SECONDS } from "@/lib/constants";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";

/** Paths from when every route carried a locale prefix. */
const LEGACY_LOCALE_PREFIX = /^\/(?:zh|en)(?=\/|$)/;

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const sessionToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  // API routes must be classified before dotted static-looking paths. The
  // proxy has no database, so it only turns away requests with no session
  // cookie at all; each route reads and checks the session itself.
  if (pathname.startsWith("/api/")) {
    const isPublicApi = pathname.startsWith("/api/v1/") || pathname.startsWith("/api/cron/");
    if (!isPublicApi && (sessionToken == null || sessionToken === "")) {
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

  // Auth protection for pages is handled by the (protected) layout. A page
  // load pushes the cookie's expiry out with the session's own sliding window,
  // which the server renews in the database.
  const response = NextResponse.next();
  if (sessionToken != null && sessionToken !== "") {
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_DAYS * TIME_SECONDS.DAY,
    });
  }
  return response;
}

export const config = {
  // Matcher ignoring static files
  matcher: ["/api/:path*", "/((?!_next|.*\\..*).*)"],
};
