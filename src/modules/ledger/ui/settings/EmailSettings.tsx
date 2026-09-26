"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  removeLoginEmailAction,
  sendLoginEmailCodeAction,
  verifyLoginEmailCodeAction,
} from "@/modules/auth/server-actions/login-emails";
import type { LoginEmailErrorCode } from "@/modules/auth/server-actions/login-emails";
import { SettingsField } from "./SettingsField";
import { commonCopy } from "@/copy/common";
import { settingsEmailsCopy } from "@/copy/settings";

interface EmailSettingsProps {
  /** The address this session signed in with, painted until the full list arrives. */
  userEmail?: string;
  onRequireReauthentication?: () => void | Promise<void>;
  /** Removing an address ends every session, so this browser has to sign in again. */
  onAllSessionsEnded?: () => void | Promise<void>;
}

/**
 * 登录邮箱: every address here signs in with a code sent to it. An address is
 * added by verifying an OTP sent to it, and the account keeps at least one, so a
 * removal can be refused with a reason rather than a crash.
 *
 * It is the field 账户 is about, so it keeps a field heading inside that card:
 * 通行密钥 and API 密钥 stand alone as cards because each saves on its own.
 */
export function EmailSettings({
  userEmail,
  onRequireReauthentication,
  onAllSessionsEnded,
}: EmailSettingsProps) {
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
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const message = (code: LoginEmailErrorCode) => {
    switch (code) {
      case "invalid_email":
        return settingsEmailsCopy.invalidEmail;
      case "invalid_code":
        return settingsEmailsCopy.invalidCode;
      case "expired_code":
        return settingsEmailsCopy.expiredCode;
      case "email_in_use":
        return settingsEmailsCopy.emailInUse;
      case "rate_limited":
        return settingsEmailsCopy.rateLimited;
      case "locked":
        return settingsEmailsCopy.locked;
      case "reauth_required":
        return settingsEmailsCopy.reauthRequired;
      case "last_email":
        return settingsEmailsCopy.lastEmail;
      default:
        return settingsEmailsCopy.unknown;
    }
  };

  const reset = () => {
    setEmail("");
    setCode("");
    setSent(false);
    setError(null);
  };

  const requestCode = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await sendLoginEmailCodeAction(email);
      if (!result.ok) {
        if (result.code === "reauth_required") {
          await onRequireReauthentication?.();
          return;
        }
        const text = message(result.code);
        setError(text);
        toast.error(text);
        return;
      }
      setSent(true);
      setCode("");
      toast.success(settingsEmailsCopy.codeSent);
    } catch {
      const text = message("unknown");
      setError(text);
      toast.error(text);
    } finally {
      setPending(false);
    }
  };

  const verify = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await verifyLoginEmailCodeAction(email, code);
      if (!result.ok) {
        if (result.code === "reauth_required") {
          await onRequireReauthentication?.();
          return;
        }
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
              <span className="min-w-0 truncate text-sm text-text">{address}</span>
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
                  setSent(false);
                  setCode("");
                  setError(null);
                }}
              />
            </div>
            {sent ? (
              <div className="grid gap-2">
                <Label htmlFor="login-email-code">{settingsEmailsCopy.verificationCode}</Label>
                <Input
                  id="login-email-code"
                  name="verificationCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  spellCheck={false}
                  value={code}
                  disabled={pending}
                  onChange={(event) => {
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                    setError(null);
                  }}
                />
              </div>
            ) : null}
            {error != null ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)} disabled={pending}>
              {commonCopy.cancel}
            </Button>
            <Button
              disabled={pending || email.trim() === "" || (sent && code.length !== 6)}
              onClick={() => void (sent ? verify() : requestCode())}
            >
              {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              {sent ? settingsEmailsCopy.verify : settingsEmailsCopy.sendCode}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removeTarget != null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={settingsEmailsCopy.removeTitle({ email: removeTarget ?? "" })}
        description={settingsEmailsCopy.removeDesc}
        confirmLabel={commonCopy.delete}
        variant="destructive"
        onConfirm={async () => {
          if (removeTarget == null) return false;
          const result = await removeLoginEmailAction(removeTarget);
          if (!result.ok) {
            if (result.code === "reauth_required") {
              await onRequireReauthentication?.();
              return false;
            }
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
