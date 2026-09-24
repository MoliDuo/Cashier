import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import { postgresBookAdapter } from "@/application/adapters/postgres/business-ports/books";
import { postgresServiceCredentialAdapter } from "@/application/adapters/postgres/business-ports/service-credentials";
import { books, serviceCredentials, sourceDocuments } from "@/persistence";
import { createTestSourceDocument } from "../../helpers/schema-setup";

/**
 * The 分账 rules the product states, checked against the real adapter: order is
 * the switcher's order, a book with records may only be archived, and the last
 * active book cannot be archived or deleted at all.
 */
describe("postgres book adapter", () => {
  async function fixture() {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const firstBookId = await testBookId(db, ledgerId);
    const created = await postgresBookAdapter.create(ledgerId, {
      name: "梁梁的",
      timeZone: "Asia/Shanghai",
    });
    return { db, ledgerId, firstBookId, secondBookId: created.id };
  }

  it("lists books in switcher order and appends new ones at the end", async () => {
    const { ledgerId, firstBookId } = await fixture();
    const third = await postgresBookAdapter.create(ledgerId, { name: "哞哞的", timeZone: null });

    const listed = await postgresBookAdapter.list(ledgerId);
    expect(listed.map((book) => book.id)).toEqual([firstBookId, expect.any(String), third.id]);
    expect(listed.map((book) => book.sortOrder)).toEqual([1, 2, 3]);
    expect(listed[0]?.name).toBe("共同支出");

    const reordered = await postgresBookAdapter.reorder(ledgerId, [
      third.id,
      firstBookId,
      listed[1]!.id,
    ]);
    expect(reordered.map((book) => book.id)).toEqual([third.id, firstBookId, listed[1]!.id]);
    expect(await postgresBookAdapter.list(ledgerId)).toEqual(reordered);
  });

  it("refuses a reorder that does not list every active book exactly once", async () => {
    const { ledgerId, firstBookId, secondBookId } = await fixture();

    await expect(postgresBookAdapter.reorder(ledgerId, [firstBookId])).rejects.toMatchObject({
      code: "BOOK_ORDER_INVALID",
    });
    await expect(
      postgresBookAdapter.reorder(ledgerId, [firstBookId, secondBookId, secondBookId])
    ).rejects.toMatchObject({ code: "BOOK_ORDER_INVALID" });
  });

  it("archives a book that holds records, even the former 总账 default", async () => {
    const { db, ledgerId, firstBookId } = await fixture();
    const holding = await postgresBookAdapter.create(ledgerId, { name: "哞哞的", timeZone: null });
    await createTestSourceDocument(db, ledgerId);
    await db
      .update(sourceDocuments)
      .set({ bookId: holding.id })
      .where(eq(sourceDocuments.ledgerId, ledgerId));

    // The first book is nothing special any more: 总账 is a view over every
    // book, so any book but the last can be retired.
    expect(await postgresBookAdapter.archive(ledgerId, firstBookId)).toMatchObject({
      status: "archived",
    });

    // A book that still holds records is what archiving is for: its records keep
    // counting in 总账 while the book leaves the switcher.
    expect(await postgresBookAdapter.list(ledgerId)).toHaveLength(2);
    expect(await postgresBookAdapter.list(ledgerId)).not.toContainEqual(
      expect.objectContaining({ id: firstBookId })
    );
    // 设置 asks for the archived rows and gets them, with their records intact.
    const withArchived = await postgresBookAdapter.list(ledgerId, { includeArchived: true });
    expect(withArchived.find((book) => book.id === firstBookId)?.archivedAt).not.toBeNull();
    // The name is free again once the book is archived.
    const reused = await postgresBookAdapter.create(ledgerId, { name: "共同支出", timeZone: null });
    expect(reused.id).not.toBe(firstBookId);
    // ...and the retired book can be resolved by id, so the detail page can name it.
    expect((await postgresBookAdapter.getIncludingArchived(ledgerId, firstBookId))?.name).toBe(
      "共同支出"
    );
  });

  it("refuses to archive the last live book, with the port's own code", async () => {
    const { ledgerId, firstBookId, secondBookId } = await fixture();
    expect(await postgresBookAdapter.archive(ledgerId, firstBookId)).toMatchObject({
      status: "archived",
    });
    await expect(postgresBookAdapter.archive(ledgerId, secondBookId)).rejects.toMatchObject({
      code: "BOOK_LAST_ACTIVE",
    });
  });

  it("refuses to archive a book that still has an active API key bound to it", async () => {
    const { ledgerId, secondBookId } = await fixture();
    await postgresServiceCredentialAdapter.create(ledgerId, "Bound", secondBookId);

    expect(await postgresBookAdapter.archive(ledgerId, secondBookId)).toEqual({
      status: "has_credentials",
    });
    expect(await postgresBookAdapter.get(ledgerId, secondBookId)).not.toBeNull();
  });

  it("archives a book whose keys are all revoked, but still refuses to delete it", async () => {
    const { ledgerId, secondBookId } = await fixture();
    const created = await postgresServiceCredentialAdapter.create(
      ledgerId,
      "Revoked",
      secondBookId
    );
    await postgresServiceCredentialAdapter.revoke(ledgerId, created.id);

    // A revoked key cannot upload and cannot be rebound, so it must not retire
    // the book forever.
    expect(await postgresBookAdapter.archive(ledgerId, secondBookId)).toMatchObject({
      status: "archived",
    });

    // The row still references the book, so the hard delete stays impossible —
    // and the refusal is the "archive it instead" one, not an impossible
    // rebinding ask.
    const restored = await postgresBookAdapter.restore(ledgerId, secondBookId);
    expect(restored.archivedAt).toBeNull();
    expect(await postgresBookAdapter.delete(ledgerId, secondBookId)).toEqual({
      status: "has_records",
    });
  });

  it("deletes only an empty book with no keys", async () => {
    const { db, ledgerId, secondBookId } = await fixture();

    // An empty, unkeyed book is removable for good.
    const third = await postgresBookAdapter.create(ledgerId, { name: "第三个", timeZone: null });
    expect(await postgresBookAdapter.delete(ledgerId, third.id)).toEqual({ status: "deleted" });
    expect(await postgresBookAdapter.getIncludingArchived(ledgerId, third.id)).toBeNull();

    // A key is a reason to keep the book: uploads would lose their target.
    await postgresServiceCredentialAdapter.create(ledgerId, "Bound", secondBookId);
    expect(await postgresBookAdapter.delete(ledgerId, secondBookId)).toEqual({
      status: "has_credentials",
    });

    // A soft-deleted record still points at the book, so it blocks a delete too.
    const holding = await postgresBookAdapter.create(ledgerId, {
      name: "有记录的",
      timeZone: null,
    });
    await createTestSourceDocument(db, ledgerId);
    await db
      .update(sourceDocuments)
      .set({ bookId: holding.id, deletedAt: new Date() })
      .where(eq(sourceDocuments.ledgerId, ledgerId));
    expect(await postgresBookAdapter.delete(ledgerId, holding.id)).toEqual({
      status: "has_records",
    });
  });

  it("refuses to delete the last live book, with the port's own code", async () => {
    const { ledgerId, firstBookId, secondBookId } = await fixture();
    await postgresBookAdapter.archive(ledgerId, firstBookId);
    await expect(postgresBookAdapter.delete(ledgerId, secondBookId)).rejects.toMatchObject({
      code: "BOOK_LAST_ACTIVE",
    });
  });

  it("restores an archived book and refuses a name that is taken by then", async () => {
    const { ledgerId, secondBookId } = await fixture();
    expect(await postgresBookAdapter.archive(ledgerId, secondBookId)).toMatchObject({
      status: "archived",
    });

    // While it is retired another book takes its name, so restoring collides.
    await postgresBookAdapter.create(ledgerId, { name: "梁梁的", timeZone: null });
    await expect(postgresBookAdapter.restore(ledgerId, secondBookId)).rejects.toMatchObject({
      code: "BOOK_NAME_TAKEN",
    });

    // Renaming the live book frees the name, and the restore then works.
    const live = (await postgresBookAdapter.list(ledgerId)).find((book) => book.name === "梁梁的")!;
    await postgresBookAdapter.update(ledgerId, live.id, { name: "别的" });
    const restored = await postgresBookAdapter.restore(ledgerId, secondBookId);
    expect(restored.archivedAt).toBeNull();
    expect((await postgresBookAdapter.list(ledgerId)).map((book) => book.id)).toContain(
      secondBookId
    );
  });

  it("refuses a name another live book already uses", async () => {
    const { ledgerId } = await fixture();

    await expect(
      postgresBookAdapter.create(ledgerId, { name: "共同支出", timeZone: null })
    ).rejects.toMatchObject({ code: "BOOK_NAME_TAKEN" });
  });

  it("binds a service credential to a book and follows it to another", async () => {
    const { ledgerId, firstBookId, secondBookId } = await fixture();
    const created = await postgresServiceCredentialAdapter.create(
      ledgerId,
      "Automation",
      firstBookId
    );

    const authenticated = await postgresServiceCredentialAdapter.authenticate(created.token);
    expect(authenticated).toMatchObject({ id: created.id, ledgerId, bookId: firstBookId });

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
    const { ledgerId, firstBookId } = await fixture();
    const other = await createTestUserWithLedger(getTestDb());
    const otherBookId = await testBookId(getTestDb(), other.ledgerId);

    await expect(
      postgresServiceCredentialAdapter.create(ledgerId, "Wrong ledger", otherBookId)
    ).rejects.toThrow(/does not belong to this ledger/);
    const created = await postgresServiceCredentialAdapter.create(ledgerId, "Fine", firstBookId);
    await expect(
      postgresServiceCredentialAdapter.setBook(ledgerId, created.id, otherBookId)
    ).rejects.toThrow(/does not belong to this ledger/);
  });

  it("stops authenticating a key whose book is archived, and resumes on restore", async () => {
    const { db, ledgerId, secondBookId } = await fixture();
    const created = await postgresServiceCredentialAdapter.create(
      ledgerId,
      "Book-bound",
      secondBookId
    );
    expect(await postgresServiceCredentialAdapter.authenticate(created.token)).not.toBeNull();

    // The adapter refuses to archive a book that still has a key, so the state is
    // produced directly here: this is the guard against a book that was retired
    // (or restored into) outside the normal path.
    await db.update(books).set({ archivedAt: new Date() }).where(eq(books.id, secondBookId));
    expect(await postgresServiceCredentialAdapter.authenticate(created.token)).toBeNull();
    // The key itself is untouched: the book only stopped accepting uploads.
    const row = await getTestDb()
      .select({ id: serviceCredentials.id })
      .from(serviceCredentials)
      .where(eq(serviceCredentials.id, created.id));
    expect(row).toHaveLength(1);

    // Bringing the book back starts the key working again.
    await postgresBookAdapter.restore(ledgerId, secondBookId);
    expect(await postgresServiceCredentialAdapter.authenticate(created.token)).not.toBeNull();
  });
});
