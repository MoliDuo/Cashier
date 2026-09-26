export interface AuthenticatedPrincipal {
  id: string;
  email: string | null;
}

/** One row of 设置 → 通行密钥; the key material never leaves the server. */
export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
}
