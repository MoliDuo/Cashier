import { notFound } from "next/navigation";
import { SetupForm } from "@/modules/setup/ui/SetupForm";
import { getSetupCodeForDisplay } from "@/modules/setup/setup-code";
import { serverComposition } from "@/application/server-composition-root";

/**
 * First-run setup. Once the account exists this page is permanently 404, which
 * is what the product promises: setup is a window, not a route.
 */
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await serverComposition.setup.isPending())) notFound();
  // Reading the code here — rather than lazily on submit — means the operator
  // sees it in the logs from the first visit to this page. It is printed only
  // when this call issues it, so a refresh does not repeat the banner, and a
  // code past its 30-minute lifetime is replaced and printed again rather than
  // leaving the wizard with a secret nobody can read.
  await getSetupCodeForDisplay(serverComposition.setup);
  return <SetupForm />;
}
