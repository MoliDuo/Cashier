"use client";
import { cn } from "@/lib/utils";
import { useCountdown } from "@/hooks/use-countdown";
import { authCopy } from "@/copy/auth";

interface ExpiryTimerProps {
  expiresAt: number | null; // Unix timestamp in seconds
  onExpired?: () => void;
  className?: string;
}

export function ExpiryTimer({ expiresAt, onExpired, className }: ExpiryTimerProps) {
  const { remaining, isExpired } = useCountdown(
    onExpired != null
      ? {
          targetTime: expiresAt,
          onExpired,
        }
      : {
          targetTime: expiresAt,
        }
  );

  if (expiresAt == null) {
    return null;
  }

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  const isUrgent = remaining > 0 && remaining <= 60;

  return (
    <div className={cn("text-sm", className)}>
      {!isExpired ? (
        <p
          className={cn(
            "tabular-nums text-muted-foreground",
            isUrgent && "text-destructive font-medium"
          )}
        >
          {authCopy.codeExpiresTimer({ time: `${minutes}:${seconds.toString().padStart(2, "0")}` })}
        </p>
      ) : (
        <p className="text-destructive font-medium">{authCopy.codeExpired}</p>
      )}
      <span aria-live="polite" className="sr-only">
        {isExpired ? authCopy.codeExpired : ""}
      </span>
    </div>
  );
}
