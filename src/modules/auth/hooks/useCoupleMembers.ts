"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { LEDGER } from "@/lib/constants";
import { getCoupleMembersAction } from "@/modules/auth/server-actions/get-couple-members";
import type { MemberProfileContract } from "@/application/contracts";

interface UseCoupleMembersOptions {
  ledgerId: string;
  /** The signed-in member; their own profile is the one editable in 设置. */
  userId: string;
  /** Hydrated from the page bootstrap, so the switch paints on the first frame. */
  initialMembers?: readonly MemberProfileContract[];
}

/**
 * Both member profiles. The labels on the member switch come from here rather
 * than from the server props, so renaming yourself in 设置 updates the switch
 * without a reload, and a cached page cannot keep showing a stale nickname.
 */
export function useCoupleMembers({ ledgerId, userId, initialMembers }: UseCoupleMembersOptions) {
  const membersQuery = useQuery({
    queryKey: queryKeys.coupleMembers(ledgerId),
    queryFn: () => getCoupleMembersAction(),
    staleTime: LEDGER.STALE_TIME_MS,
    ...(initialMembers !== undefined ? { initialData: [...initialMembers] } : {}),
  });
  const members = membersQuery.data;
  return {
    members,
    me: members?.find((member) => member.id === userId) ?? null,
    partner: members?.find((member) => member.id !== userId) ?? null,
    membersQuery,
  };
}
