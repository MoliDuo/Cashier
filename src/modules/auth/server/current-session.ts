import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { runtimeEnv } from "@/lib/env/runtime";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";
import { createSession, deleteSession, readSession, type SessionUser } from "./sessions";

/** The session this request's cookie names, read once per request. */
export const getCurrentSession = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (token == null || token === "") return null;
  return readSession(token);
});

function secureCookies(): boolean {
  return new URL(runtimeEnv.appUrl).protocol === "https:";
}

/**
 * Signs the browser in: replaces the session its cookie named, if any, with a
 * new one. Server actions only, since only they may set cookies.
 */
export async function startSession(userId: string): Promise<void> {
  const jar = await cookies();
  const previous = jar.get(SESSION_COOKIE_NAME)?.value;
  if (previous != null && previous !== "") await deleteSession(previous);
  const { token, expiresAt } = await createSession(userId);
  jar.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Signs the browser out. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (token != null && token !== "") await deleteSession(token);
  jar.delete(SESSION_COOKIE_NAME);
}
