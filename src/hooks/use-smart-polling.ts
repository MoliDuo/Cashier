import { useCallback, useRef } from "react";

interface UseSmartPollingOptions<TData> {
  isPollingActive: (data: TData | undefined) => boolean;
  /**
   * Turns polling on and off for a session. `0` and `""` mean "not polling";
   * anything else means the schedule runs and is reset whenever the key
   * changes.
   */
  sessionKey: number | string;
  /**
   * Restarts the interval schedule when the entity being polled changes inside
   * one session — a second job should not inherit the schedule the first one
   * already spent. Derive it from the data so the caller needs no state.
   */
  resetToken?: (data: TData | undefined) => string | number;
  intervalsMs?: readonly number[];
}

const DEFAULT_INTERVALS_MS = [3000, 30_000, 60_000, 60_000, 60_000] as const;

export function useSmartPolling<TData>({
  isPollingActive,
  sessionKey,
  resetToken,
  intervalsMs = DEFAULT_INTERVALS_MS,
}: UseSmartPollingOptions<TData>) {
  const pollingRef = useRef({
    sessionKey: 0 as number | string,
    resetToken: "" as string | number,
    dataUpdatedAt: 0,
    intervalIndex: 0,
  });

  return useCallback(
    (query: { state: { data: TData | undefined; dataUpdatedAt: number } }) => {
      if (sessionKey === 0 || sessionKey === "" || !isPollingActive(query.state.data)) return false;

      const polling = pollingRef.current;
      const token = resetToken?.(query.state.data) ?? "";
      if (polling.sessionKey !== sessionKey || polling.resetToken !== token) {
        polling.sessionKey = sessionKey;
        polling.resetToken = token;
        polling.dataUpdatedAt = query.state.dataUpdatedAt;
        polling.intervalIndex = 0;
      } else if (polling.dataUpdatedAt !== query.state.dataUpdatedAt) {
        // The index advances on every response, not only on a change.
        polling.dataUpdatedAt = query.state.dataUpdatedAt;
        polling.intervalIndex += 1;
      }

      return intervalsMs[polling.intervalIndex] ?? false;
    },
    [intervalsMs, isPollingActive, resetToken, sessionKey]
  );
}
