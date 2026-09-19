"use client";

import { useEffect, useRef, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export interface RefreshButtonProps {
  onRefresh: () => Promise<unknown> | unknown;
  isRefreshing: boolean;
  disabled?: boolean;
}

export function RefreshButton({ onRefresh, isRefreshing, disabled = false }: RefreshButtonProps) {
  const t = useTranslations("Common");
  const [succeeded, setSucceeded] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
    },
    []
  );

  const refresh = async () => {
    if (disabled || isRefreshing) return;
    setSucceeded(false);
    setManualRefreshing(true);
    try {
      await onRefresh();
      setSucceeded(true);
      if (timerRef.current != null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setSucceeded(false), 1800);
    } catch {
      toast.error(t("refreshFailed"));
    } finally {
      setManualRefreshing(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="shrink-0"
      onClick={() => void refresh()}
      disabled={disabled || isRefreshing || manualRefreshing}
      aria-label={t("refresh")}
      title={t("refresh")}
    >
      {succeeded && !isRefreshing && !manualRefreshing ? (
        <Check aria-hidden="true" className="h-4 w-4 text-success" />
      ) : (
        <RefreshCw
          aria-hidden="true"
          className={isRefreshing || manualRefreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"}
        />
      )}
      <span aria-live="polite" className="sr-only">
        {succeeded && !isRefreshing && !manualRefreshing ? t("refreshSuccess") : ""}
      </span>
    </Button>
  );
}
