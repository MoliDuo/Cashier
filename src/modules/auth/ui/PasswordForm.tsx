"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatInstantDateLabel } from "@/lib/date-utils";
import { changePasswordAction } from "@/modules/auth/server-actions/change-password";
import { setPasswordAction } from "@/modules/auth/server-actions/set-password";
import type { PasswordMutationActionErrorCode } from "@/modules/auth/contracts";
import { CredentialChangeDialog } from "./CredentialChangeDialog";
import { DISPLAY_LOCALE } from "@/lib/constants";

function PasswordField(props: {
  id: string;
  label: string;
  value: string;
  autoComplete: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("Settings.Account");
  const [visible, setVisible] = useState(false);
  return (
    <div className="grid gap-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <div className="relative">
        <Input
          id={props.id}
          name={props.id}
          type={visible ? "text" : "password"}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          autoComplete={props.autoComplete}
          disabled={props.disabled}
          className="h-11 pr-12"
        />
        <button
          type="button"
          disabled={props.disabled}
          onClick={() => setVisible((value) => !value)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-text"
          aria-label={visible ? t("hidePassword") : t("showPassword")}
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Eye aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

export function PasswordForm({
  hasPassword,
  passwordUpdatedAt,
  onRequireReauthentication,
  onCredentialsChanged,
}: {
  hasPassword: boolean;
  passwordUpdatedAt: string | null;
  onRequireReauthentication?: () => void | Promise<void>;
  onCredentialsChanged?: () => void | Promise<void>;
}) {
  const t = useTranslations("Settings.Account");
  const tCommon = useTranslations("Common");
  const locale = DISPLAY_LOCALE;
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPasswordUpdatedAt, setSavedPasswordUpdatedAt] = useState<string | null>(
    passwordUpdatedAt
  );
  const [savedHasPassword, setSavedHasPassword] = useState(hasPassword);

  const messageForErrorCode = (code: PasswordMutationActionErrorCode) => {
    switch (code) {
      case "password_too_short":
        return t("passwordTooShort");
      case "password_requirements_not_met":
        return t("passwordRequirementsNotMet");
      case "password_mismatch":
        return t("passwordsDoNotMatch");
      case "current_password_wrong":
        return t("currentPasswordWrong");
      case "password_rate_limited":
        return t("passwordRateLimited");
      case "reauth_required":
        return t("reauthRequired");
      case "conflict":
        return t("passwordConflict");
      case "validation_failed":
      case "unexpected":
        return t("passwordError");
    }
  };

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
  };
  const close = () => {
    setOpen(false);
    reset();
  };

  const submit = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const input = { currentPassword, newPassword, confirmPassword };
      const result = savedHasPassword
        ? await changePasswordAction(input)
        : await setPasswordAction(input);
      if (!result.ok) {
        if (result.code === "reauth_required") {
          await onRequireReauthentication?.();
          return;
        }
        setError(messageForErrorCode(result.code));
        return;
      }
      setSavedPasswordUpdatedAt(result.passwordUpdatedAt);
      setSavedHasPassword(true);
      toast.success(t("passwordSaved"));
      setOpen(false);
      reset();
      await onCredentialsChanged?.();
    } catch {
      setError(t("passwordError"));
    } finally {
      setIsLoading(false);
    }
  };

  const matches = newPassword !== "" && newPassword === confirmPassword;
  const canSubmit = matches && (!savedHasPassword || currentPassword !== "");

  return (
    // One line at every width: the status and its one button are a single
    // reading row, so a narrow screen wraps the text instead of the button.
    <div className="flex w-full items-center justify-between gap-3">
      <span className="min-w-0 text-sm text-muted-foreground">
        {savedPasswordUpdatedAt == null
          ? t("passwordNotSet")
          : t("passwordLastChanged", {
              date: formatInstantDateLabel(savedPasswordUpdatedAt, locale, {
                today: tCommon("today"),
                yesterday: tCommon("yesterday"),
              }),
            })}
      </span>
      <div className="shrink-0">
        <CredentialChangeDialog
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) reset();
          }}
          pending={isLoading}
          triggerLabel={savedHasPassword ? t("changePasswordButton") : t("setPasswordButton")}
          title={savedHasPassword ? t("changePasswordTitle") : t("setPasswordTitle")}
          description={t("passwordRequirements")}
          desktopWidth="md"
          footer={
            <>
              <Button variant="outline" onClick={close} disabled={isLoading}>
                {t("cancel")}
              </Button>
              <Button onClick={submit} disabled={!canSubmit || isLoading}>
                {isLoading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                {t("savePassword")}
              </Button>
            </>
          }
        >
          {savedHasPassword ? (
            <PasswordField
              id="current-password"
              label={t("currentPassword")}
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              disabled={isLoading}
            />
          ) : null}
          <PasswordField
            id="new-password"
            label={t("newPassword")}
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            disabled={isLoading}
          />
          <PasswordField
            id="confirm-password"
            label={t("confirmPassword")}
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            disabled={isLoading}
          />
          {confirmPassword !== "" && !matches ? (
            <p role="alert" className="text-sm text-destructive">
              {t("passwordsDoNotMatch")}
            </p>
          ) : null}
          {error != null ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </CredentialChangeDialog>
      </div>
    </div>
  );
}
