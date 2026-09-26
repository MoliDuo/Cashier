"use client";

import { useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startRegistration } from "@simplewebauthn/browser";
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
import { formatInstantDateLabel } from "@/lib/date-utils";
import { LEDGER, DISPLAY_LOCALE } from "@/lib/constants";
import { queryKeys } from "@/lib/query-keys";
import {
  deletePasskeyAction,
  finishPasskeyRegistrationAction,
  renamePasskeyAction,
  startPasskeyRegistrationAction,
  type PasskeyActionErrorCode,
} from "@/modules/auth/server-actions/passkeys";
import { fetchPasskeys } from "@/modules/auth/queries";
import { isCancelledCeremony, usePasskeySupport } from "@/modules/auth/hooks/use-passkey-support";
import { PASSKEY_NAME_MAX_LENGTH } from "@/modules/auth/constants";
import type { PasskeySummary } from "@/modules/auth/contracts";
import { commonCopy } from "@/copy/common";
import { settingsPasskeysCopy } from "@/copy/settings";

interface PasskeySettingsProps {
  onRequireReauthentication?: () => void | Promise<void>;
}

/**
 * 通行密钥: the account's main way in. Adding or deleting one needs a sign-in
 * from the last ten minutes, so a borrowed open session cannot swap them; the
 * last one can still go, because a login email always remains.
 */
export function PasskeySettings({ onRequireReauthentication }: PasskeySettingsProps) {
  const locale = DISPLAY_LOCALE;
  const queryClient = useQueryClient();
  const key = queryKeys.passkeys();
  const supported = usePasskeySupport();
  const { data: passkeys = [], isPending: isListPending } = useQuery({
    queryKey: key,
    queryFn: fetchPasskeys,
    staleTime: LEDGER.STALE_TIME_MS,
  });
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<PasskeySummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PasskeySummary | null>(null);

  const message = (code: PasskeyActionErrorCode) => {
    switch (code) {
      case "expired":
        return settingsPasskeysCopy.expired;
      case "invalid":
        return settingsPasskeysCopy.invalid;
      case "duplicate":
        return settingsPasskeysCopy.duplicate;
      case "not_found":
        return settingsPasskeysCopy.notFound;
      case "reauth_required":
        return settingsPasskeysCopy.reauthRequired;
      default:
        return settingsPasskeysCopy.unknown;
    }
  };

  const dateLabel = (instant: string) => formatInstantDateLabel(instant, locale);

  const fail = async (code: PasskeyActionErrorCode) => {
    if (code === "reauth_required") {
      setIsAddOpen(false);
      await onRequireReauthentication?.();
      return;
    }
    const text = message(code);
    setError(text);
    toast.error(text);
  };

  const register = async () => {
    setPending(true);
    setError(null);
    try {
      const start = await startPasskeyRegistrationAction();
      if (!start.ok) {
        await fail(start.code);
        return;
      }
      let response;
      try {
        response = await startRegistration({ optionsJSON: start.options });
      } catch (ceremonyError) {
        if (isCancelledCeremony(ceremonyError)) return;
        // InvalidStateError: this authenticator already holds one of ours.
        await fail(
          ceremonyError instanceof Error && ceremonyError.name === "InvalidStateError"
            ? "duplicate"
            : "invalid"
        );
        return;
      }
      const result = await finishPasskeyRegistrationAction(start.challengeId, response, name);
      if (!result.ok) {
        await fail(result.code);
        return;
      }
      queryClient.setQueryData<PasskeySummary[]>(key, (current = []) => [
        ...current,
        result.passkey,
      ]);
      toast.success(settingsPasskeysCopy.added);
      setIsAddOpen(false);
      setName("");
    } catch {
      await fail("unexpected");
    } finally {
      setPending(false);
    }
  };

  const rename = async () => {
    if (renameTarget == null) return;
    setPending(true);
    setError(null);
    try {
      const result = await renamePasskeyAction(renameTarget.id, renameValue);
      if (!result.ok) {
        await fail(result.code);
        return;
      }
      const renamed = renameValue.trim();
      queryClient.setQueryData<PasskeySummary[]>(key, (current = []) =>
        current.map((passkey) =>
          passkey.id === renameTarget.id ? { ...passkey, name: renamed } : passkey
        )
      );
      toast.success(settingsPasskeysCopy.renamed);
      setRenameTarget(null);
    } catch {
      await fail("unexpected");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-muted-foreground">
            {supported ? settingsPasskeysCopy.description : settingsPasskeysCopy.unsupported}
          </p>
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            disabled={!supported}
            onClick={() => {
              setName(settingsPasskeysCopy.defaultName);
              setError(null);
              setIsAddOpen(true);
            }}
          >
            {settingsPasskeysCopy.add}
          </Button>
        </div>
        {passkeys.length > 0 ? (
          <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
            {passkeys.map((passkey) => (
              <li key={passkey.id} className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-text">{passkey.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {passkey.lastUsedAt == null
                      ? settingsPasskeysCopy.createdAt({ date: dateLabel(passkey.createdAt) })
                      : settingsPasskeysCopy.lastUsedAt({ date: dateLabel(passkey.lastUsedAt) })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={settingsPasskeysCopy.rename({ name: passkey.name })}
                    title={settingsPasskeysCopy.rename({ name: passkey.name })}
                    className="text-muted-foreground"
                    onClick={() => {
                      setRenameValue(passkey.name);
                      setError(null);
                      setRenameTarget(passkey);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={settingsPasskeysCopy.delete({ name: passkey.name })}
                    title={settingsPasskeysCopy.delete({ name: passkey.name })}
                    className="text-muted-foreground hover:text-danger"
                    onClick={() => setDeleteTarget(passkey)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : isListPending ? null : (
          <p className="rounded-[var(--radius)] border border-dashed border-border p-3 text-sm text-muted-foreground">
            {settingsPasskeysCopy.empty}
          </p>
        )}
      </div>

      <Dialog open={isAddOpen} onOpenChange={(open) => !pending && setIsAddOpen(open)}>
        <DialogContent variant="modal">
          <DialogHeader>
            <DialogTitle>{settingsPasskeysCopy.addTitle}</DialogTitle>
            <DialogDescription>{settingsPasskeysCopy.addDesc}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-passkey-name">{settingsPasskeysCopy.name}</Label>
              <Input
                id="new-passkey-name"
                name="passkeyName"
                autoComplete="off"
                maxLength={PASSKEY_NAME_MAX_LENGTH}
                value={name}
                disabled={pending}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
            </div>
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
            <Button disabled={pending || name.trim() === ""} onClick={() => void register()}>
              {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              {settingsPasskeysCopy.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameTarget != null}
        onOpenChange={(open) => !pending && !open && setRenameTarget(null)}
      >
        <DialogContent variant="modal">
          <DialogHeader>
            <DialogTitle>{settingsPasskeysCopy.renameTitle}</DialogTitle>
            <DialogDescription>{settingsPasskeysCopy.renameDesc}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <div className="grid gap-2">
              <Label htmlFor="rename-passkey-name">{settingsPasskeysCopy.name}</Label>
              <Input
                id="rename-passkey-name"
                name="passkeyName"
                autoComplete="off"
                maxLength={PASSKEY_NAME_MAX_LENGTH}
                value={renameValue}
                disabled={pending}
                onChange={(event) => {
                  setRenameValue(event.target.value);
                  setError(null);
                }}
              />
            </div>
            {error != null ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)} disabled={pending}>
              {commonCopy.cancel}
            </Button>
            <Button disabled={pending || renameValue.trim() === ""} onClick={() => void rename()}>
              {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              {commonCopy.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={settingsPasskeysCopy.deleteTitle({ name: deleteTarget?.name ?? "" })}
        description={
          passkeys.length <= 1
            ? settingsPasskeysCopy.deleteLastDesc
            : settingsPasskeysCopy.deleteDesc
        }
        confirmLabel={commonCopy.delete}
        variant="destructive"
        onConfirm={async () => {
          if (deleteTarget == null) return false;
          const target = deleteTarget;
          const result = await deletePasskeyAction(target.id);
          if (!result.ok) {
            if (result.code === "reauth_required") {
              setDeleteTarget(null);
              await onRequireReauthentication?.();
              return false;
            }
            toast.error(message(result.code));
            return false;
          }
          queryClient.setQueryData<PasskeySummary[]>(key, (current = []) =>
            current.filter((passkey) => passkey.id !== target.id)
          );
          toast.success(settingsPasskeysCopy.deleted);
          setDeleteTarget(null);
          return true;
        }}
      />
    </>
  );
}
