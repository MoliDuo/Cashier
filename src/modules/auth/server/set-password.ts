import "server-only";
import { AppError, NotFoundError } from "@/lib/errors";
import { AUTH_ERROR_CODES } from "@/modules/auth/errors";
import { hashPassword } from "@/modules/auth/services/password";
import { validatePassword } from "@/modules/auth/services/password-policy";
import { setInitialPasswordHash } from "./account-security";

export async function setPassword(params: {
  userId: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<Date> {
  if (params.newPassword !== params.confirmPassword) {
    throw new AppError("Passwords do not match", AUTH_ERROR_CODES.PASSWORD_MISMATCH, 400);
  }
  validatePassword(params.newPassword);

  const passwordHash = await hashPassword(params.newPassword);
  const passwordUpdatedAt = new Date();
  const updated = await setInitialPasswordHash({
    userId: params.userId,
    passwordHash,
    passwordUpdatedAt,
  });
  if (!updated) throw new NotFoundError("User without a password");
  return passwordUpdatedAt;
}
