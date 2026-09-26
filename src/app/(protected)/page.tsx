import { redirect } from "next/navigation";
import { legacyLedgerHref } from "@/modules/workspace/legacy-ledger-url";

interface HomePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** `/` and every `/?tab=…` bookmark land on the tab's own route. */
export default async function HomePage({ searchParams }: HomePageProps) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first != null) params.set(key, first);
  }
  redirect(legacyLedgerHref(params));
}
