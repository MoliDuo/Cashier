import { and, desc, eq, isNull } from "drizzle-orm";
import type { ServiceCredentialPort } from "@/application/contracts";
import { db } from "@/lib/db";
import { ConflictError, RateLimitUnavailableError } from "@/lib/errors";
import { logError } from "@/lib/error-handlers";
import { ledgers, serviceCredentials } from "@/persistence";
import { createToken, computeHash } from "@/lib/security/service-credential-token";
import { lockLedgerForUpdate } from "../transaction-locks";
import { getCoupleConfig, isCoupleMember } from "@/lib/couple-config";
import { postgresLedgerAdapter } from "./ledger";

import { SERVICE_CREDENTIAL_LAST_USED_STALE_MS, toIso } from "./shared";

export const postgresServiceCredentialAdapter: ServiceCredentialPort = {
  async authenticate(key) {
    // Hash-based lookup: compute hash and match in DB
    const computedHash = computeHash(key);

    const hashMatch = await db
      .select({
        id: serviceCredentials.id,
        ledgerId: serviceCredentials.ledgerId,
        attributedUserId: serviceCredentials.attributedUserId,
        lastUsedAt: serviceCredentials.lastUsedAt,
      })
      .from(serviceCredentials)
      .innerJoin(
        ledgers,
        and(eq(ledgers.id, serviceCredentials.ledgerId), isNull(ledgers.deletedAt))
      )
      .where(
        and(eq(serviceCredentials.tokenHash, computedHash), isNull(serviceCredentials.deletedAt))
      )
      .then((rows) => rows[0]);

    if (
      hashMatch &&
      hashMatch.ledgerId === getCoupleConfig()?.ledgerId &&
      hashMatch.attributedUserId != null &&
      isCoupleMember(hashMatch.attributedUserId) &&
      (await postgresLedgerAdapter.canAccess(hashMatch.ledgerId, hashMatch.attributedUserId))
    ) {
      // Throttle the lastUsedAt write: credentials used within the last five
      // minutes skip the UPDATE entirely, so status polling cannot amplify
      // write load for hot credentials.
      const lastUsedAt = hashMatch.lastUsedAt;
      const stale =
        lastUsedAt == null ||
        Date.now() - lastUsedAt.getTime() > SERVICE_CREDENTIAL_LAST_USED_STALE_MS;
      if (stale) {
        try {
          const [updated] = await db
            .update(serviceCredentials)
            .set({ lastUsedAt: new Date() })
            .where(
              and(eq(serviceCredentials.id, hashMatch.id), isNull(serviceCredentials.deletedAt))
            )
            .returning({ id: serviceCredentials.id });
          // Revoke-race guard: if credential was revoked between SELECT and UPDATE,
          // the UPDATE returns 0 rows — return null to prevent auth through revoked credential.
          if (!updated) return null;
        } catch (error) {
          logError("modules/ledger:authenticate-service-credential:update-last-used", error);
          throw new RateLimitUnavailableError();
        }
      } else {
        // Fresh path: skip the lastUsedAt write, but keep the revocation fence
        // with a locking re-read. FOR SHARE waits for any in-flight revoke and
        // re-evaluates the deletedAt predicate against the committed row, so a
        // credential revoked after the hash lookup still fails this request —
        // the same guarantee the stale path gets from its conditional UPDATE.
        const active = await db
          .select({ id: serviceCredentials.id })
          .from(serviceCredentials)
          .where(and(eq(serviceCredentials.id, hashMatch.id), isNull(serviceCredentials.deletedAt)))
          .for("share")
          .limit(1)
          .then((rows) => rows[0]);
        if (active == null) return null;
      }
      // The authenticated contract is deliberately bounded to id + ledgerId;
      // lastUsedAt is read internally only to throttle the write.
      return {
        id: hashMatch.id,
        ledgerId: hashMatch.ledgerId,
        attributedUserId: hashMatch.attributedUserId,
      };
    }

    return null;
  },

  async list(ledgerId) {
    const rows = await db
      .select()
      .from(serviceCredentials)
      .where(and(eq(serviceCredentials.ledgerId, ledgerId), isNull(serviceCredentials.deletedAt)))
      .orderBy(desc(serviceCredentials.createdAt))
      .limit(20);
    return rows.map((row) => ({
      id: row.id,
      attributedUserId: row.attributedUserId,
      tokenPrefix: row.tokenPrefix ?? "",
      tokenSuffix: row.tokenSuffix ?? "",
      ledgerId: row.ledgerId,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: toIso(row.lastUsedAt),
    }));
  },

  async create(ledgerId, name, userId) {
    if (!isCoupleMember(userId) || ledgerId !== getCoupleConfig()?.ledgerId)
      throw new ConflictError("Invalid shared credential owner");
    const { token, hash, prefix, suffix } = createToken();
    const row = await db.transaction(async (tx) => {
      await lockLedgerForUpdate(tx, ledgerId);
      const active = await tx
        .select({ id: serviceCredentials.id })
        .from(serviceCredentials)
        .where(
          and(eq(serviceCredentials.ledgerId, ledgerId), isNull(serviceCredentials.deletedAt))
        );
      if (active.length >= 20) {
        throw new ConflictError("A ledger can have at most 20 active service credentials.");
      }
      return tx
        .insert(serviceCredentials)
        .values({
          ledgerId,
          name,
          attributedUserId: userId,
          tokenHash: hash,
          tokenPrefix: prefix,
          tokenSuffix: suffix,
        })
        .returning()
        .then((rows) => rows[0]);
    });
    if (row == null) throw new ConflictError("Failed to create service credential");
    return {
      id: row.id,
      token: token,
      attributedUserId: row.attributedUserId,
      tokenPrefix: row.tokenPrefix ?? "",
      tokenSuffix: row.tokenSuffix ?? "",
      ledgerId: row.ledgerId,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: toIso(row.lastUsedAt),
    };
  },

  async revoke(ledgerId, credentialId) {
    const result = await db
      .update(serviceCredentials)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(serviceCredentials.ledgerId, ledgerId),
          eq(serviceCredentials.id, credentialId),
          isNull(serviceCredentials.deletedAt)
        )
      )
      .returning({ id: serviceCredentials.id });
    if (result.length === 1) return "revoked";

    const existing = await db
      .select({ id: serviceCredentials.id })
      .from(serviceCredentials)
      .where(
        and(eq(serviceCredentials.ledgerId, ledgerId), eq(serviceCredentials.id, credentialId))
      )
      .limit(1);
    return existing.length === 1 ? "already_revoked" : "not_found";
  },
};
