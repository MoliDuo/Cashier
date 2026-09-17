import { UnauthorizedError } from "@/lib/errors";
import type { MemberProfileContract, MemberProfileUpdateContract } from "@/application/contracts";
import type { UserProfilePort } from "@/application/contracts";

/**
 * Writes the signed-in member's own row. The user id comes from the session and
 * never from the payload, so one member cannot edit the other.
 */
export async function updateMyProfile(
  userId: string,
  input: MemberProfileUpdateContract,
  profiles: UserProfilePort
): Promise<MemberProfileContract> {
  const updated = await profiles.updateProfile({ userId, profile: input });
  if (updated == null) throw new UnauthorizedError();
  return updated;
}
