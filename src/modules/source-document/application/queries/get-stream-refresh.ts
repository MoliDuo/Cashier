import type { LedgerRefreshRequest, LedgerRefreshResult } from "../../contract-refresh";
import type { LedgerChangeReadPort } from "../ports";

const MAX_BIGINT_VERSION = BigInt("9223372036854775807");
const FULL_INVALIDATIONS = { categories: true, settings: true, stats: true } as const;
const NO_INVALIDATIONS = { categories: false, settings: false, stats: false } as const;

function parseVersion(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export async function getStreamRefresh(
  ledgerId: string,
  request: LedgerRefreshRequest,
  changes: LedgerChangeReadPort
): Promise<LedgerRefreshResult> {
  const parsedVersion = parseVersion(request.afterVersion);
  const requestVersionIsInvalid =
    parsedVersion == null || parsedVersion < BigInt(0) || parsedVersion > MAX_BIGINT_VERSION;
  const afterVersion = requestVersionIsInvalid ? BigInt(0) : parsedVersion;
  const summary = await changes.summarizeChanges({ ledgerId, afterVersion });
  const base = {
    version: summary.currentVersion.toString(),
    hasTransitionalWork: summary.hasTransitionalWork,
  };

  if (requestVersionIsInvalid || afterVersion > summary.currentVersion) {
    return { ...base, changed: true, invalidations: FULL_INVALIDATIONS };
  }

  if (afterVersion === summary.currentVersion) {
    return { ...base, changed: false, invalidations: NO_INVALIDATIONS };
  }

  return {
    ...base,
    changed: true,
    invalidations: {
      categories: summary.categoriesChanged,
      settings: summary.settingsChanged,
      stats: summary.statsChanged,
    },
  };
}
