"use client";

import { useState } from "react";
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
  const [setupCode, setSetupCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bookNames, setBookNames] = useState<string[]>(["共同支出"]);
  const [defaultBook, setDefaultBook] = useState("共同支出");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const message = (code: SetupErrorCode) => {
    switch (code) {
      case "already_done":
        return t("alreadyDone");
      case "wrong_code":
        return t("wrongCode");
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

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await completeSetupAction({
      setupCode,
      email,
      password,
      locale,
      books: bookNames,
      defaultBook,
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
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label>{t("books")}</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending || bookNames.length >= 20}
              onClick={() => setBookNames((current) => [...current, ""])}
            >
              <Plus className="mr-1 size-4" />
              {t("addBook")}
            </Button>
          </div>
          {bookNames.map((name, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={name}
                maxLength={20}
                aria-label={t("bookName")}
                placeholder={t("bookName")}
                disabled={pending}
                onChange={(event) =>
                  setBookNames((current) => {
                    const next = [...current];
                    const previous = next[index] ?? "";
                    next[index] = event.target.value;
                    // Keep the default selection pointed at the row the reader
                    // just renamed instead of silently dropping it.
                    setDefaultBook((currentDefault) =>
                      currentDefault === previous ? event.target.value : currentDefault
                    );
                    return next;
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={pending || bookNames.length <= 1}
                aria-label={t("removeBook")}
                onClick={() =>
                  setBookNames((current) => current.filter((_, position) => position !== index))
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <div className="grid gap-2">
            <Label htmlFor="setup-default-book">{t("defaultBook")}</Label>
            <Select value={defaultBook} onValueChange={setDefaultBook} disabled={pending}>
              <SelectTrigger id="setup-default-book" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {bookNames
                  .filter((name) => name.trim() !== "")
                  .map((name) => (
                    <SelectItem key={name} value={name.trim()}>
                      {name}
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
