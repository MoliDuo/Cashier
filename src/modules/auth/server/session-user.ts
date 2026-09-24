import "server-only";
import { cache } from "react";
import { UnauthorizedError } from "@/lib/errors";
import { findUserById } from "./users";

/** The signed-in account, read once per request. */
export const getSessionUser = cache(async (userId: string) => {
  const user = await findUserById(userId);
  if (user == null) throw new UnauthorizedError("User not found in database");
  return user;
});
