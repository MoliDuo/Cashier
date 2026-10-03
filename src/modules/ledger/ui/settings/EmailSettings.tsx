"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { queryKeys } from "@/lib/query-keys";
import { LEDGER } from "@/lib/constants";
import { fetchLoginEmails } from "@/modules/auth/queries";
import {
  addLoginEmailAction,
  removeLoginEmailAction,
} from "@/modules/auth/server-actions/login-emails";
import type { LoginEmailErrorCode } from "@/modules/auth/server-actions/login-emails";
import { SettingsField } from "@/components/SettingsField";
import { commonCopy } from "@/copy/common";
import { settingsEmailsCopy } from "@/copy/settings";

interface EmailSettingsProps {
  /** The address this session signed in with, painted until the full list arrives. */
  userEmail?: string;
  /** Removing an address ends every session, so this browser has to sign in again. */
  onAllSessionsEnded?: () => void | Promise<void>;
}

/**
 * 登录邮箱: the addresses allowed to sign in. Whoever the identity provider
 * knows by one of them gets in, so adding one needs no code. The account keeps
 * at least one, so a removal can be refused with a reason rather than a crash.
 *
 * It is the field 账户 is about, so it keeps a field heading inside that card:
 * API 密钥 stands alone as a card because it saves on its own.
 */
export function EmailSettings({ userEmail, onAllSessionsEnded }: EmailSettingsProps) {
  const queryClient = useQueryClient();
  const key = queryKeys.loginEmails();
  const { data } = useQuery({
    queryKey: key,
    queryFn: fetchLoginEmails,
    staleTime: LEDGER.STALE_TIME_MS,
  });
  // The in-page tab only knows the signed-in address, so the query fills in the
  // full list; until it answers (or if it fails) the address still paints, which
  // keeps the last-email rule's disabled Remove correct.
  const emails = data ?? (userEmail == null || userEmail === "" ? [] : [userEmail]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const message = (code: LoginEmailErrorCode) => {
    switch (code) {
      case "invalid_email":
        return settingsEmailsCopy.invalidEmail;
      case "email_in_use":
        return settingsEmailsCopy.emailInUse;
      case "last_email":
        return settingsEmailsCopy.lastEmail;
      default:
        return settingsEmailsCopy.unknown;
    }
  };

  const reset = () => {
    setEmail("");
    setError(null);
  };

  const add = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await addLoginEmailAction(email);
      if (!result.ok) {
        const text = message(result.code);
        setError(text);
        toast.error(text);
        return;
      }
      queryClient.setQueryData<string[]>(key, result.emails);
      toast.success(settingsEmailsCopy.added);
      setIsAddOpen(false);
      reset();
    } catch {
      const text = message("unknown");
      setError(text);
      toast.error(text);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <SettingsField
        title={settingsEmailsCopy.title}
        stacked
        actions={
          <Button type="button" size="sm" onClick={() => setIsAddOpen(true)}>
            {settingsEmailsCopy.add}
          </Button>
        }
      >
        <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
          {emails.map((address) => (
            <li key={address} className="flex items-center justify-between gap-2 p-3">
              <span className={textRoleClassName("body", "min-w-0 truncate")}>{address}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={emails.length <= 1}
                aria-label={settingsEmailsCopy.remove({ email: address })}
                title={
                  emails.length <= 1
                    ? settingsEmailsCopy.lastEmail
                    : settingsEmailsCopy.remove({ email: address })
                }
                className="shrink-0 text-muted-foreground hover:text-danger"
                onClick={() => setRemoveTarget(address)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      </SettingsField>

      <Dialog open={isAddOpen} onOpenChange={(open) => !pending && setIsAddOpen(open)}>
        <DialogContent variant="modal">
          <DialogHeader>
            <DialogTitle>{settingsEmailsCopy.addTitle}</DialogTitle>
            <DialogDescription>{settingsEmailsCopy.addDesc}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-login-email">{settingsEmailsCopy.newEmail}</Label>
              <Input
                id="new-login-email"
                type="email"
                name="email"
                autoComplete="email"
                spellCheck={false}
                value={email}
                disabled={pending}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError(null);
                }}
              />
            </div>
            {error != null ? (
              <p role="alert" className={textRoleClassName("body", "text-destructive")}>
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)} disabled={pending}>
              {commonCopy.cancel}
            </Button>
            <Button disabled={pending || email.trim() === ""} onClick={() => void add()}>
              {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              {settingsEmailsCopy.addConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removeTarget != null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={settingsEmailsCopy.removeTitle({ email: removeTarget ?? "" })}
        description={settingsEmailsCopy.removeDesc}
        confirmLabel={settingsEmailsCopy.removeConfirm}
        variant="destructive"
        onConfirm={async () => {
          if (removeTarget == null) return false;
          const result = await removeLoginEmailAction(removeTarget);
          if (!result.ok) {
            toast.error(message(result.code));
            return false;
          }
          queryClient.setQueryData<string[]>(key, result.emails);
          // Removing an address ended every session, not only this one; the
          // login screen repeats the notice after sign-out.
          toast.success(settingsEmailsCopy.sessionsEnded);
          setRemoveTarget(null);
          await onAllSessionsEnded?.();
          return true;
        }}
      />
    </>
  );
}
