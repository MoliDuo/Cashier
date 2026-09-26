"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { authCopy } from "@/copy/auth";

interface EmailStepProps {
  callbackUrl: string;
  email: string;
  isLoading: boolean;
  error: string | null;
  onEmailChange: (email: string) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}

export function EmailStep({
  callbackUrl: _callbackUrl,
  email,
  isLoading,
  error,
  onEmailChange,
  onSubmit,
}: EmailStepProps) {
  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-text">
            {authCopy.email}
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder={authCopy.emailPlaceholder}
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            required
            disabled={isLoading}
            className="h-11"
            autoComplete="email"
            autoFocus
          />
        </div>
        {error != null && (
          <div role="alert" className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}
        <Button type="submit" className="w-full h-11" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
              {authCopy.sending}
            </>
          ) : (
            authCopy.sendVerificationCode
          )}
        </Button>
      </form>
    </div>
  );
}
