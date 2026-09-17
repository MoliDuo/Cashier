"use server";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";
import type { MemberProfileContract, MemberProfileUpdateContract } from "@/application/contracts";
import { parseUpdateMyProfileInput } from "@/modules/auth/profile-schemas";
import { updateMyProfile } from "@/modules/auth/application/use-cases/profile";
import { serverComposition } from "@/application/server-composition-root";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (session?.user?.id == null || session.user.id === "") throw new UnauthorizedError();
  return session.user.id;
}

/** Updates the signed-in member's nickname, gender, and time zone. */
export async function updateMyProfileAction(
  input: MemberProfileUpdateContract
): Promise<MemberProfileContract> {
  const userId = await requireUserId();
  const validated = parseUpdateMyProfileInput(input);
  return updateMyProfile(userId, validated, serverComposition.userProfiles);
}
