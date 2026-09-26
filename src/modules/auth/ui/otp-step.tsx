"use client";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";
import { OTPInput } from "./otp-input";
import { ResendCountdown } from "./resend-countdown";
import { ExpiryTimer } from "./expiry-timer";
import { authCopy } from "@/copy/auth";

interface OtpStepProps {
  otp: string;
  isLoading: boolean;
  error: string | null;
  expiresAt: number | null;
  canResendAt: number | null;
  onOtpChange: (otp: string) => void;
  onVerify: () => void;
  onResend: () => Promise<void>;
  onChangeEmail: () => void;
  onExpired: () => void;
  resendPending: boolean;
  otpExpired: boolean;
}

export function OtpStep({
  otp,
  isLoading,
  error,
  expiresAt,
  canResendAt,
  onOtpChange,
  onVerify,
  onResend,
  onChangeEmail,
  onExpired,
  resendPending,
  otpExpired,
}: OtpStepProps) {
  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        onVerify();
      }}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <span id="otp-code-label" className="text-sm font-medium text-text">
            {authCopy.enterCode}
          </span>
          <div role="group" aria-labelledby="otp-code-label">
            <OTPInput
              value={otp}
              onChange={onOtpChange}
              disabled={isLoading || resendPending}
              getDigitLabel={(position, length) =>
                authCopy.otpDigitLabel({ index: position, length })
              }
            />
          </div>
        </div>
        <ExpiryTimer expiresAt={expiresAt} onExpired={onExpired} className="text-center" />
      </div>
      {error != null && (
        <div role="alert" className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}
      <Button
        type="submit"
        className="w-full h-11"
        disabled={isLoading || resendPending || otpExpired || !/^\d{6}$/.test(otp)}
      >
        {isLoading ? (
          <>
            <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
            {authCopy.verifying}
          </>
        ) : (
          authCopy.verify
        )}
      </Button>
      <div className="flex items-center justify-between pt-4 border-t">
        <Button
          type="button"
          variant="ghost"
          onClick={onChangeEmail}
          disabled={isLoading || resendPending}
          className="text-sm"
        >
          <ArrowLeft aria-hidden="true" className="mr-2 h-4 w-4" />
          {authCopy.changeEmail}
        </Button>
        <ResendCountdown
          canResendAt={canResendAt}
          onResend={onResend}
          disabled={isLoading || resendPending}
        />
      </div>
      {resendPending ? (
        <p className="text-center text-sm text-muted-foreground" aria-live="polite">
          {authCopy.resendInProgress}
        </p>
      ) : null}
    </form>
  );
}
