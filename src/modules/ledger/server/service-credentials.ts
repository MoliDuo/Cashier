import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
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
import { lockLedgerForUpdate } from "@/lib/db/transaction-locks";
import type {
  AuthenticatedServiceCredential,
  CreatedServiceCredentialDto,
  ServiceCredentialDto,
} from "@/modules/ledger/contracts";

const MAX_ACTIVE_CREDENTIALS = 20;

/** lastUsedAt updates are throttled to once per five minutes per credential. */
const SERVICE_CREDENTIAL_LAST_USED_STALE_MS = 5 * 60 * 1000;

/**
 * The one translation from a stored key to what the browser may see. It names
 * every field instead of spreading the stored row: a token, a hash or anything
 * a later migration adds to the row must be published on purpose.
 */
function toServiceCredentialDto(row: typeof serviceCredentials.$inferSelect): ServiceCredentialDto {
  return {
    id: row.id,
    bookId: row.bookId,
    tokenPrefix: row.tokenPrefix ?? "",
    tokenSuffix: row.tokenSuffix ?? "",
    ledgerId: row.ledgerId,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    deletedAt: null,
  };
}

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

export async function authenticateServiceCredential(
  key: string
): Promise<AuthenticatedServiceCredential | null> {
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
    .innerJoin(ledgers, and(eq(ledgers.id, serviceCredentials.ledgerId), isNull(ledgers.deletedAt)))
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
    lastUsedAt == null || Date.now() - lastUsedAt.getTime() > SERVICE_CREDENTIAL_LAST_USED_STALE_MS;
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
  }
  // The authenticated contract is deliberately bounded to id, ledgerId and
  // the key's book; lastUsedAt is read internally only to throttle the write.
  return {
    id: hashMatch.id,
    ledgerId: hashMatch.ledgerId,
    bookId: hashMatch.bookId,
  };
}

export async function listServiceCredentials(ledgerId: string): Promise<ServiceCredentialDto[]> {
  const rows = await db
    .select()
    .from(serviceCredentials)
    .where(and(eq(serviceCredentials.ledgerId, ledgerId), isNull(serviceCredentials.deletedAt)))
    .orderBy(desc(serviceCredentials.createdAt))
    .limit(MAX_ACTIVE_CREDENTIALS);
  return rows.map(toServiceCredentialDto);
}

export async function createServiceCredential(
  ledgerId: string,
  input: { name: string; bookId: string }
): Promise<CreatedServiceCredentialDto> {
  const { name, bookId } = input;
  const { token, hash, prefix, suffix } = createToken();
  const row = await db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx, ledgerId);
    await assertBookInLedger(tx, ledgerId, bookId);
    const active = await tx
      .select({ id: serviceCredentials.id })
      .from(serviceCredentials)
      .where(and(eq(serviceCredentials.ledgerId, ledgerId), isNull(serviceCredentials.deletedAt)));
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
  // The plaintext token is shown once, here, and never reaches the browser's
  // view of the ledger's keys.
  return { ...toServiceCredentialDto(row), token };
}

/**
 * Rebinds a live key to another book; uploads follow it immediately. Throws
 * `NotFoundError` for a missing key and `BookUnavailableError` for a book outside
 * the ledger.
 */
export async function setServiceCredentialBook(
  ledgerId: string,
  credentialId: string,
  bookId: string
): Promise<ServiceCredentialDto> {
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
  return toServiceCredentialDto(updated);
}

/** Revoking an already revoked key is a no-op; an unknown key is `NotFoundError`. */
export async function revokeServiceCredential(
  ledgerId: string,
  credentialId: string
): Promise<void> {
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
  if (result.length === 1) return;

  const existing = await db
    .select({ id: serviceCredentials.id })
    .from(serviceCredentials)
    .where(and(eq(serviceCredentials.ledgerId, ledgerId), eq(serviceCredentials.id, credentialId)))
    .limit(1);
  if (existing.length === 0) throw new NotFoundError("Credential");
}
