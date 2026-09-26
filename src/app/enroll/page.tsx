import type { Metadata } from "next";
import { EnrollPasskeyPage } from "@/modules/auth/ui/enroll-page";
import { enrollmentTokenSchema, findEnrollmentUser } from "@/modules/auth/server/enrollment";

/** The link is checked against the database on every visit. */
export const dynamic = "force-dynamic";

/** The token is in the URL; nothing this page links to may receive it. */
export const metadata: Metadata = { referrer: "no-referrer" };

interface EnrollPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EnrollPage({ searchParams }: EnrollPageProps) {
  const parsed = enrollmentTokenSchema.safeParse((await searchParams).token);
  const token =
    parsed.success && (await findEnrollmentUser(parsed.data)) != null ? parsed.data : null;
  return <EnrollPasskeyPage token={token} />;
}
