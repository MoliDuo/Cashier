"use server";

import { auth } from "@/auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { isCoupleMember } from "@/lib/couple-config";
import type { MemberProfileContract } from "@/application/contracts";
import { getCoupleMembers } from "@/modules/auth/application/queries/get-couple-members";
import { serverComposition } from "@/application/server-composition-root";

/** Both member profiles, owner first; read again after an edit to refresh labels. */
export async function getCoupleMembersAction(): Promise<readonly MemberProfileContract[]> {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId == null || userId === "") throw new UnauthorizedError();
  if (!isCoupleMember(userId)) throw new ForbiddenError();
  return getCoupleMembers(serverComposition.userProfiles);
}
