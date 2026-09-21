import { Suspense } from "react";
import { LedgerPageSkeleton } from "@/components/skeletons";
import { ActiveTab } from "./_active-tab";

export const maxDuration = 120;

interface HomePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = await searchParams;

  return (
    <Suspense fallback={<LedgerPageSkeleton />}>
      <ActiveTab searchParams={resolvedSearchParams} />
    </Suspense>
  );
}
