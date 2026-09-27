"use client";

import { useEffect, useState } from "react";
import { getDateInTimezone } from "@/lib/date-utils";

function todayIn(timeZone: string): string {
  return getDateInTimezone(timeZone) ?? getDateInTimezone("UTC")!;
}

/**
 * Today in the ledger's zone. It is checked again every minute and whenever the
 * page comes back into view, so a tab left open overnight moves to the new day
 * instead of reading yesterday's month.
 */
export function useLedgerToday(timeZone: string, initialToday?: string): string {
  const [today, setToday] = useState(() => initialToday ?? todayIn(timeZone));

  useEffect(() => {
    const update = () => setToday(todayIn(timeZone));
    update();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") update();
    };
    const interval = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [timeZone]);

  return today;
}
