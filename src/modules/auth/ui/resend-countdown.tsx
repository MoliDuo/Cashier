"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useCountdown } from "@/hooks/use-countdown";
import { authCopy } from "@/copy/auth";

interface ResendCountdownProps {
  canResendAt: number | null; // Unix timestamp in seconds
  onResend: () => Promise<void>;
  disabled?: boolean;
}

export function ResendCountdown({ canResendAt, onResend, disabled = false }: ResendCountdownProps) {
  const { remaining } = useCountdown({ targetTime: canResendAt });
  const [isLoading, setIsLoading] = useState(false);

  const handleResend = async () => {
    setIsLoading(true);
    try {
      await onResend();
    } finally {
      setIsLoading(false);
    }
  };

  const isDisabled = disabled || isLoading || remaining > 0;

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={isDisabled}
      onClick={handleResend}
      className="text-sm"
    >
      {isLoading && <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />}
      {remaining > 0 ? authCopy.resendIn({ seconds: remaining }) : authCopy.resend}
    </Button>
  );
}
