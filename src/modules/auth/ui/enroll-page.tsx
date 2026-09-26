"use client";

import Link from "next/link";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { textRoleClassName } from "@/components/typography";
import { useEnrollFlow } from "../hooks/use-enroll-flow";
import { enrollCopy } from "@/copy/auth";

export function EnrollPasskeyPage({ token }: { token: string | null }) {
  const flow = useEnrollFlow(token);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-8">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
        {flow.linkValid ? (
          <>
            <h1 className={textRoleClassName("pageTitle")}>{enrollCopy.title}</h1>
            <p className={textRoleClassName("bodyMuted", "mt-2")}>{enrollCopy.description}</p>
            {flow.passkeySupported ? (
              <Button
                type="button"
                className="mt-6 min-h-11 w-full"
                disabled={flow.pending}
                onClick={() => void flow.enroll()}
              >
                {flow.pending ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <KeyRound aria-hidden="true" className="size-4" />
                )}
                {enrollCopy.submit}
              </Button>
            ) : (
              <p className={textRoleClassName("body", "mt-6")}>{enrollCopy.unsupported}</p>
            )}
            {flow.error != null ? (
              <p
                role="alert"
                className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
              >
                {flow.error}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <h1 className={textRoleClassName("pageTitle")}>{enrollCopy.invalidLinkTitle}</h1>
            <p className={textRoleClassName("bodyMuted", "mt-2")}>{enrollCopy.invalidLinkDesc}</p>
            <Button asChild variant="outline" className="mt-6 min-h-11 w-full">
              <Link href="/login">{enrollCopy.backToLogin}</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
