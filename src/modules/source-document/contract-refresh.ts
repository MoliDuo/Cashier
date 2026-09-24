export interface LedgerRefreshRequest {
  afterVersion: string;
}

export interface LedgerRefreshResult {
  version: string;
  changed: boolean;
  hasTransitionalWork: boolean;
  invalidations: {
    categories: boolean;
    settings: boolean;
    stats: boolean;
  };
}
