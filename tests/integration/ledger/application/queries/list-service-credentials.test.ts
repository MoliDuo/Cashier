import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger } from "tests/helpers/schema-setup";
import { books, serviceCredentials } from "@/persistence";
import { listServiceCredentials as listServiceCredentialsUseCase } from "@/modules/ledger/application/queries/list-service-credentials";
import { createServiceCredential } from "@/modules/ledger/application/use-cases/create-service-credential";
import { setServiceCredentialBook } from "@/modules/ledger/application/use-cases/set-service-credential-book";
import { serverComposition } from "@/application/server-composition-root";

/** Every field a key is published with, and nothing else. */
const PUBLISHED_CREDENTIAL_FIELDS = [
  "bookId",
  "createdAt",
  "deletedAt",
  "id",
  "lastUsedAt",
  "ledgerId",
  "name",
  "tokenPrefix",
  "tokenSuffix",
];

const listServiceCredentials = (ledgerId: string) =>
  listServiceCredentialsUseCase(ledgerId, serverComposition.serviceCredentials);

describe("listServiceCredentials", () => {
  let ledgerId = "";

  beforeEach(async () => {
    const { ledgerId: createdLedgerId } = await createTestUserWithLedger(getTestDb());
    ledgerId = createdLedgerId;
  });

  it("returns active credentials sorted by newest first and mapped to DTOs", async () => {
    const db = getTestDb();

    await db.insert(serviceCredentials).values([
      {
        id: crypto.randomUUID(),
        ledgerId,
        name: "older",
        tokenHash: "a".repeat(64),
        tokenPrefix: "sk_older",
        tokenSuffix: "lder",
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
        lastUsedAt: new Date("2026-03-05T00:00:00.000Z"),
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      },
      {
        id: crypto.randomUUID(),
        ledgerId,
        name: "deleted",
        tokenHash: "b".repeat(64),
        tokenPrefix: "sk_delet",
        tokenSuffix: "eted",
        createdAt: new Date("2026-03-02T00:00:00.000Z"),
        deletedAt: new Date("2026-03-06T00:00:00.000Z"),
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      },
      {
        id: crypto.randomUUID(),
        ledgerId,
        name: "newest",
        tokenHash: "c".repeat(64),
        tokenPrefix: "sk_newes",
        tokenSuffix: "west",
        createdAt: new Date("2026-03-03T00:00:00.000Z"),
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      },
    ]);
    // Note: token_prefix/token_suffix are set for the test, but the adapter
    // returns them from the DB - these are just for valid DB state.
    // The adapter's list method returns tokenPrefix/tokenSuffix from the row.

    const result = await listServiceCredentials(ledgerId);

    expect(result.map((credential) => credential.name)).toEqual(["newest", "older"]);
    expect(result[0]?.createdAt).toBe("2026-03-03T00:00:00.000Z");
    expect(result[1]?.lastUsedAt).toBe("2026-03-05T00:00:00.000Z");
    expect(result.every((credential) => credential.deletedAt == null)).toBe(true);
  });

  it("publishes the same fields through every exit, with a token only at creation", async () => {
    const db = getTestDb();
    const [firstBook] = await db
      .select({ id: books.id })
      .from(books)
      .where(eq(books.ledgerId, ledgerId));
    const [secondBook] = await db
      .insert(books)
      .values({ ledgerId, name: "存证", sortOrder: 2 })
      .returning({ id: books.id });

    const created = await createServiceCredential(
      ledgerId,
      { name: "CI", bookId: firstBook!.id },
      serverComposition.serviceCredentials
    );
    expect(Object.keys(created).sort()).toEqual([...PUBLISHED_CREDENTIAL_FIELDS, "token"].sort());
    expect(created.token).not.toBe("");

    const listed = await listServiceCredentials(ledgerId);
    expect(Object.keys(listed[0]!).sort()).toEqual(PUBLISHED_CREDENTIAL_FIELDS);

    const rebound = await setServiceCredentialBook(
      ledgerId,
      created.id,
      secondBook!.id,
      serverComposition.serviceCredentials
    );
    expect(Object.keys(rebound).sort()).toEqual(PUBLISHED_CREDENTIAL_FIELDS);
    expect(rebound.bookId).toBe(secondBook!.id);
  });
});
