import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import { postgresBookAdapter } from "@/application/adapters/postgres/business-ports/books";
import { postgresServiceCredentialAdapter } from "@/application/adapters/postgres/business-ports/service-credentials";
import { serviceCredentials, sourceDocuments } from "@/persistence";
import { createTestSourceDocument } from "../../helpers/schema-setup";

/**
 * The 分账 rules the product states, checked against the real adapter: order is
 * the switcher's order, a book with records may only be archived, and the last
 * active book and the 总账 default cannot be archived at all.
 */
describe("postgres book adapter", () => {
  async function fixture() {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const defaultBookId = await testBookId(db, ledgerId);
    const created = await postgresBookAdapter.create(ledgerId, {
      name: "梁梁的",
      timeZone: "Asia/Shanghai",
    });
    return { db, ledgerId, defaultBookId, secondBookId: created.id };
  }

  it("lists books in switcher order and appends new ones at the end", async () => {
    const { ledgerId, defaultBookId } = await fixture();
    const third = await postgresBookAdapter.create(ledgerId, { name: "哞哞的", timeZone: null });

    const listed = await postgresBookAdapter.list(ledgerId);
    expect(listed.map((book) => book.id)).toEqual([defaultBookId, expect.any(String), third.id]);
    expect(listed.map((book) => book.sortOrder)).toEqual([1, 2, 3]);
    expect(listed[0]?.name).toBe("共同支出");
    expect(listed[0]?.isDefault).toBe(true);

    const reordered = await postgresBookAdapter.reorder(ledgerId, [
      third.id,
      defaultBookId,
      listed[1]!.id,
    ]);
    expect(reordered.map((book) => book.id)).toEqual([third.id, defaultBookId, listed[1]!.id]);
    expect(await postgresBookAdapter.list(ledgerId)).toEqual(reordered);
  });

  it("refuses a reorder that does not list every active book exactly once", async () => {
    const { ledgerId, defaultBookId, secondBookId } = await fixture();

    await expect(postgresBookAdapter.reorder(ledgerId, [defaultBookId])).rejects.toThrow(
      /every active book/
    );
    await expect(
      postgresBookAdapter.reorder(ledgerId, [defaultBookId, secondBookId, secondBookId])
    ).rejects.toThrow();
  });

  it("moves the 总账 default flag and keeps exactly one", async () => {
    const { ledgerId, defaultBookId, secondBookId } = await fixture();

    const booksAfter = await postgresBookAdapter.setDefault(ledgerId, secondBookId);
    expect(booksAfter.filter((book) => book.isDefault).map((book) => book.id)).toEqual([
      secondBookId,
    ]);
    expect(booksAfter.find((book) => book.id === defaultBookId)?.isDefault).toBe(false);
  });

  it("archives an empty non-default book and refuses the default", async () => {
    const { db, ledgerId, defaultBookId } = await fixture();
    const empty = await postgresBookAdapter.create(ledgerId, { name: "哞哞的", timeZone: null });

    // Archiving the 总账 default would leave records entered from 总账 with
    // nowhere to go, so it is refused before the record count is even read.
    await expect(postgresBookAdapter.archive(ledgerId, defaultBookId)).rejects.toThrow(
      /default book cannot be archived/
    );
    expect(await postgresBookAdapter.archive(ledgerId, empty.id)).toBe("archived");
    expect(await postgresBookAdapter.get(ledgerId, empty.id)).toBeNull();
    // The name is free again once the book is archived.
    const reused = await postgresBookAdapter.create(ledgerId, { name: "哞哞的", timeZone: null });
    expect(reused.id).not.toBe(empty.id);

    // A book that holds records can only be archived, never deleted.
    await createTestSourceDocument(db, ledgerId);
    const holding = await postgresBookAdapter.create(ledgerId, {
      name: "有记录的",
      timeZone: null,
    });
    await db
      .update(sourceDocuments)
      .set({ bookId: holding.id })
      .where(eq(sourceDocuments.ledgerId, ledgerId));
    expect(await postgresBookAdapter.countDocuments(ledgerId, holding.id)).toBe(1);
    expect(await postgresBookAdapter.archive(ledgerId, holding.id)).toBe("has_records");
  });

  it("refuses a name another live book already uses", async () => {
    const { ledgerId } = await fixture();

    await expect(
      postgresBookAdapter.create(ledgerId, { name: "共同支出", timeZone: null })
    ).rejects.toThrow(/already exists/);
  });

  it("binds a service credential to a book and follows it to another", async () => {
    const { ledgerId, defaultBookId, secondBookId } = await fixture();
    const created = await postgresServiceCredentialAdapter.create(
      ledgerId,
      "Automation",
      defaultBookId
    );

    const authenticated = await postgresServiceCredentialAdapter.authenticate(created.token);
    expect(authenticated).toMatchObject({ id: created.id, ledgerId, bookId: defaultBookId });

    const moved = await postgresServiceCredentialAdapter.setBook(
      ledgerId,
      created.id,
      secondBookId
    );
    expect(moved?.bookId).toBe(secondBookId);
    expect(await postgresServiceCredentialAdapter.authenticate(created.token)).toMatchObject({
      bookId: secondBookId,
    });
  });

  it("refuses a credential pointed at another ledger's book", async () => {
    const { ledgerId, defaultBookId } = await fixture();
    const other = await createTestUserWithLedger(getTestDb());
    const otherBookId = await testBookId(getTestDb(), other.ledgerId);

    await expect(
      postgresServiceCredentialAdapter.create(ledgerId, "Wrong ledger", otherBookId)
    ).rejects.toThrow(/does not belong to this ledger/);
    const created = await postgresServiceCredentialAdapter.create(ledgerId, "Fine", defaultBookId);
    await expect(
      postgresServiceCredentialAdapter.setBook(ledgerId, created.id, otherBookId)
    ).rejects.toThrow(/does not belong to this ledger/);
  });

  it("stops authenticating a key whose book was archived", async () => {
    const { ledgerId, secondBookId } = await fixture();
    const created = await postgresServiceCredentialAdapter.create(
      ledgerId,
      "Book-bound",
      secondBookId
    );

    expect(await postgresServiceCredentialAdapter.authenticate(created.token)).not.toBeNull();
    await postgresBookAdapter.archive(ledgerId, secondBookId);
    expect(await postgresServiceCredentialAdapter.authenticate(created.token)).toBeNull();
    // The key itself is untouched: the book only stopped accepting uploads.
    const row = await getTestDb()
      .select({ id: serviceCredentials.id })
      .from(serviceCredentials)
      .where(eq(serviceCredentials.id, created.id));
    expect(row).toHaveLength(1);
  });
});
