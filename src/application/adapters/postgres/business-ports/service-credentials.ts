import { and, desc, eq, isNull } from "drizzle-orm";
import type { ServiceCredentialPort } from "@/application/contracts";
import { db } from "@/lib/db";
import {
  BookUnavailableError,
  ConflictError,
  NotFoundError,
  RateLimitUnavailableError,
} from "@/lib/errors";
import { logError } from "@/lib/error-handlers";
import { books, ledgers, serviceCredentials } from "@/persistence";
import { createToken, computeHash } from "@/lib/security/service-credential-token";
import { lockLedgerForUpdate } from "../transaction-locks";

import { SERVICE_CREDENTIAL_LAST_USED_STALE_MS, toIso } from "./shared";

const MAX_ACTIVE_CREDENTIALS = 20;

/**
 * A key may only be bound to a live book of the same ledger. The failure is
 * `BookUnavailableError` rather than a plain conflict: the client has to tell a
 * bad or archived book apart from the active-credential cap, which is also a
 * conflict, or it reports the wrong reason.
 */
async function assertBookInLedger(
  executor: Pick<typeof db, "select">,
  ledgerId: string,
  bookId: string
): Promise<void> {
  const row = await executor
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.ledgerId, ledgerId), isNull(books.archivedAt)))
    .limit(1)
    .then((rows) => rows[0]);
  if (row == null) throw new BookUnavailableError("Book does not belong to this ledger");
}

export const postgresServiceCredentialAdapter: ServiceCredentialPort = {
  async authenticate(key) {
    // Hash-based lookup: compute hash and match in DB
    const computedHash = computeHash(key);

    const hashMatch = await db
      .select({
        id: serviceCredentials.id,
        ledgerId: serviceCredentials.ledgerId,
        bookId: serviceCredentials.bookId,
        lastUsedAt: serviceCredentials.lastUsedAt,
      })
      .from(serviceCredentials)
      .innerJoin(
        ledgers,
        and(eq(ledgers.id, serviceCredentials.ledgerId), isNull(ledgers.deletedAt))
      )
      // An archived book stops accepting uploads through its keys; the key
      // itself is untouched and starts working again if the book is restored.
      .innerJoin(books, and(eq(books.id, serviceCredentials.bookId), isNull(books.archivedAt)))
      .where(
        and(eq(serviceCredentials.tokenHash, computedHash), isNull(serviceCredentials.deletedAt))
      )
      .then((rows) => rows[0]);

    if (hashMatch == null) return null;

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
          .where(and(eq(serviceCredentials.id, hashMatch.id), isNull(serviceCredentials.deletedAt)))
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
    // The authenticated contract is deliberately bounded to id, ledgerId and
    // the key's book; lastUsedAt is read internally only to throttle the write.
    return {
      id: hashMatch.id,
      ledgerId: hashMatch.ledgerId,
      bookId: hashMatch.bookId,
    };
  },

  async list(ledgerId) {
    const rows = await db
      .select()
      .from(serviceCredentials)
      .where(and(eq(serviceCredentials.ledgerId, ledgerId), isNull(serviceCredentials.deletedAt)))
      .orderBy(desc(serviceCredentials.createdAt))
      .limit(MAX_ACTIVE_CREDENTIALS);
    return rows.map((row) => ({
      id: row.id,
      bookId: row.bookId,
      tokenPrefix: row.tokenPrefix ?? "",
      tokenSuffix: row.tokenSuffix ?? "",
      ledgerId: row.ledgerId,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: toIso(row.lastUsedAt),
    }));
  },

  async create(ledgerId, name, bookId) {
    const { token, hash, prefix, suffix } = createToken();
    const row = await db.transaction(async (tx) => {
      await lockLedgerForUpdate(tx, ledgerId);
      await assertBookInLedger(tx, ledgerId, bookId);
      const active = await tx
        .select({ id: serviceCredentials.id })
        .from(serviceCredentials)
        .where(
          and(eq(serviceCredentials.ledgerId, ledgerId), isNull(serviceCredentials.deletedAt))
        );
      if (active.length >= MAX_ACTIVE_CREDENTIALS) {
        throw new ConflictError("A ledger can have at most 20 active service credentials.");
      }
      return tx
        .insert(serviceCredentials)
        .values({
          ledgerId,
          name,
          bookId,
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
      token,
      bookId: row.bookId,
      tokenPrefix: row.tokenPrefix ?? "",
      tokenSuffix: row.tokenSuffix ?? "",
      ledgerId: row.ledgerId,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: toIso(row.lastUsedAt),
    };
  },

  async setBook(ledgerId, credentialId, bookId) {
    const updated = await db.transaction(async (tx) => {
      await lockLedgerForUpdate(tx, ledgerId);
      await assertBookInLedger(tx, ledgerId, bookId);
      return tx
        .update(serviceCredentials)
        .set({ bookId })
        .where(
          and(
            eq(serviceCredentials.ledgerId, ledgerId),
            eq(serviceCredentials.id, credentialId),
            isNull(serviceCredentials.deletedAt)
          )
        )
        .returning()
        .then((rows) => rows[0]);
    });
    if (updated == null) throw new NotFoundError("Service credential");
    return {
      id: updated.id,
      bookId: updated.bookId,
      tokenPrefix: updated.tokenPrefix ?? "",
      tokenSuffix: updated.tokenSuffix ?? "",
      ledgerId: updated.ledgerId,
      name: updated.name,
      createdAt: updated.createdAt.toISOString(),
      lastUsedAt: toIso(updated.lastUsedAt),
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
