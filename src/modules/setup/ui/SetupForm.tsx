"use client";

import { useRef, useState } from "react";
import { useRouter } from "@/i18n/routing";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { textRoleClassName } from "@/components/typography";
import { completeSetupAction, type SetupErrorCode } from "@/modules/setup/server-actions/setup";

interface BookRow {
  id: number;
  name: string;
}

/**
 * First-run wizard. It is reachable only while the database is empty, asks for
 * the setup code the server printed to its logs, and creates the account, the
 * ledger, the books and the default categories in one transaction.
 */
export function SetupForm() {
  const t = useTranslations("Setup");
  const tCommon = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const nextBookId = useRef(1);
  const [setupCode, setSetupCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // One row per book, each with a stable id: keying by name would remount the
  // input (and drop the caret) as soon as two rows traded names.
  const [bookRows, setBookRows] = useState<BookRow[]>(() => [{ id: 0, name: t("sharedBookName") }]);
  const [defaultBookId, setDefaultBookId] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const message = (code: SetupErrorCode) => {
    switch (code) {
      case "already_done":
        return t("alreadyDone");
      case "wrong_code":
        return t("wrongCode");
      case "code_expired":
        return t("codeExpired");
      case "code_locked_out":
        return t("codeLockedOut");
      case "invalid_email":
        return t("invalidEmail");
      case "weak_password":
        return t("weakPassword");
      case "invalid_books":
        return t("invalidBooks");
      default:
        return tCommon("error");
    }
  };

  const setRowName = (id: number, name: string) =>
    setBookRows((current) => current.map((row) => (row.id === id ? { ...row, name } : row)));

  /**
   * The server enforces the real policy; this only saves the reader a round trip
   * and a generic-looking failure when the password obviously cannot pass. The
   * rule mirrors `validatePassword`: 8–128 characters with a letter and a digit.
   */
  const passwordLooksValid =
    password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
  const showPasswordHint = password !== "" && !passwordLooksValid;

  const removeRow = (id: number) => {
    setBookRows((current) => {
      const next = current.filter((row) => row.id !== id);
      // The default has to keep pointing at a row that exists. Removing it
      // moves the flag to the first remaining row rather than leaving the
      // select bound to a value that is no longer in the list.
      if (id === defaultBookId && next[0] != null) setDefaultBookId(next[0].id);
      return next;
    });
  };

  const defaultRow = bookRows.find((row) => row.id === defaultBookId);
  const defaultBookName = defaultRow?.name.trim() ?? "";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (!passwordLooksValid) {
      setError(t("weakPassword"));
      return;
    }
    setPending(true);
    setError(null);
    const result = await completeSetupAction({
      setupCode,
      email,
      password,
      locale,
      books: bookRows.map((row) => row.name),
      defaultBook: defaultBookName,
    });
    if (!result.ok) {
      setError(message(result.code));
      setPending(false);
      return;
    }
    router.replace("/login?notice=setup_complete");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-8">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-6 rounded-lg border border-border bg-surface p-6"
      >
        <div>
          <h1 className={textRoleClassName("pageTitle")}>{t("title")}</h1>
          <p className={textRoleClassName("bodyMuted", "mt-2")}>{t("description")}</p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="setup-code">{t("setupCode")}</Label>
          <Input
            id="setup-code"
            value={setupCode}
            autoComplete="off"
            inputMode="numeric"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => setSetupCode(event.target.value)}
          />
          <p className="text-micro text-muted-foreground">{t("setupCodeDesc")}</p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="setup-email">{t("email")}</Label>
          <Input
            id="setup-email"
            type="email"
            value={email}
            autoComplete="email"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="setup-password">{t("password")}</Label>
          <Input
            id="setup-password"
            type="password"
            value={password}
            autoComplete="new-password"
            disabled={pending}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className="text-micro text-muted-foreground">{t("passwordDesc")}</p>
          {showPasswordHint ? (
            <p role="alert" className="text-micro text-destructive">
              {t("weakPassword")}
            </p>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label>{t("books")}</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending || bookRows.length >= 20}
              onClick={() =>
                setBookRows((current) => {
                  const id = nextBookId.current;
                  nextBookId.current += 1;
                  return [...current, { id, name: "" }];
                })
              }
            >
              <Plus className="mr-1 size-4" />
              {t("addBook")}
            </Button>
          </div>
          {bookRows.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <Input
                value={row.name}
                maxLength={20}
                aria-label={t("bookName")}
                placeholder={t("bookName")}
                disabled={pending}
                onChange={(event) => setRowName(row.id, event.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={pending || bookRows.length <= 1}
                aria-label={t("removeBook")}
                onClick={() => removeRow(row.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <div className="grid gap-2">
            <Label htmlFor="setup-default-book">{t("defaultBook")}</Label>
            <Select
              value={defaultRow == null ? "" : String(defaultRow.id)}
              onValueChange={(value) => setDefaultBookId(Number(value))}
              disabled={pending}
            >
              <SelectTrigger id="setup-default-book" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {bookRows
                  .filter((row) => row.name.trim() !== "")
                  .map((row) => (
                    <SelectItem key={row.id} value={String(row.id)}>
                      {row.name.trim()}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-micro text-muted-foreground">{t("defaultBookDesc")}</p>
          </div>
        </div>

        {error != null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Loader2 aria-hidden="true" className="mr-2 size-4 animate-spin" /> : null}
          {t("submit")}
        </Button>
      </form>
    </div>
  );
}
