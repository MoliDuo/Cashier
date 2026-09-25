import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { LEASE_DURATION_MS, LEASE_HEARTBEAT_MS } from "@/config/tuning";

// The one lease rule every background flow shares. Leases are timed by the
// database clock only, so workers on different machines agree on expiry: a
// lease is held while its expiry is later than `clock_timestamp()` and free
// otherwise. `leaseFree` and `leaseHeldBy` are exact opposites for one token.

type LeaseColumn = AnyPgColumn | SQL;

/** The lease can be claimed: nobody holds it, or its holder let it expire. */
export function leaseFree(token: LeaseColumn, expiresAt: LeaseColumn): SQL {
  return sql`(${token} IS NULL OR ${expiresAt} <= clock_timestamp())`;
}

/** The lease is still held by this token; writes that finish work fence on it. */
export function leaseHeldBy(token: LeaseColumn, expiresAt: LeaseColumn, claimToken: string): SQL {
  return sql`(${token} = ${claimToken} AND ${expiresAt} > clock_timestamp())`;
}

/** The expiry a claim or renewal sets. */
export function leaseExpiry(): SQL {
  return sql`clock_timestamp() + make_interval(secs => ${LEASE_DURATION_MS / 1000})`;
}

/** A moment the given delay from the database clock, for scheduling a retry. */
export function databaseClockPlus(delayMs: number): SQL {
  return sql`clock_timestamp() + make_interval(secs => ${delayMs / 1000})`;
}

export interface HeldLease {
  /** Aborts once the lease is lost or cannot be renewed. */
  signal: AbortSignal;
  stop(): void;
}

/**
 * Renews a lease on a heartbeat while its work runs. The work is aborted as
 * soon as a renewal finds the lease gone or fails, since a worker that cannot
 * prove it still holds the lease must not go on to write results.
 */
export function holdLease(
  renew: () => Promise<boolean>,
  onLost: (reason: "lost" | "renewal_failed", error?: unknown) => void
): HeldLease {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const beat = async (): Promise<void> => {
    if (stopped) return;
    try {
      if (!(await renew())) {
        onLost("lost");
        controller.abort();
        return;
      }
    } catch (error) {
      onLost("renewal_failed", error);
      controller.abort();
      return;
    }
    if (!stopped) timer = setTimeout(() => void beat(), LEASE_HEARTBEAT_MS);
  };
  timer = setTimeout(() => void beat(), LEASE_HEARTBEAT_MS);

  return {
    signal: controller.signal,
    stop() {
      stopped = true;
      if (timer != null) clearTimeout(timer);
    },
  };
}
