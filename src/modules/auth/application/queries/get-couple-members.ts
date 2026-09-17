import { AppError } from "@/lib/errors";
import type { MemberProfileContract, UserProfilePort } from "@/application/contracts";

/**
 * The two people sharing this ledger, owner first, so a caller resolves 我 and
 * 对方 by comparing ids rather than by position. Reads through the port so the
 * member order and the deleted-account rules live in one place instead of in
 * each page.
 */
export async function getCoupleMembers(
  profiles: Pick<UserProfilePort, "listMembers">
): Promise<readonly [MemberProfileContract, MemberProfileContract]> {
  const members = await profiles.listMembers();
  if (members.length !== 2) {
    throw new AppError("Couple members are not configured", "MEMBERS_NOT_CONFIGURED", 500);
  }
  return [members[0]!, members[1]!];
}
