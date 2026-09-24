import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../../setup";
import { updateMissingCategoryMetadata } from "@/modules/ledger/server/categories";
import { createTestUserWithLedger } from "../../../helpers/schema-setup";
import { entryCategories } from "@/persistence";

describe("category metadata backfill", () => {
  let ledgerId: string;

  beforeEach(async () => {
    const { ledgerId: createdLedgerId } = await createTestUserWithLedger(getTestDb());
    ledgerId = createdLedgerId;
  });

  async function createCategory(
    overrides: Partial<{ icon: string | null; description: string | null }> = {}
  ) {
    const db = getTestDb();
    const row = (
      await db
        .insert(entryCategories)
        .values({
          ledgerId,
          name: "Backfill",
          icon: overrides.icon ?? null,
          description: overrides.description ?? null,
        })
        .returning()
    )[0];
    if (row == null) throw new Error("Expected category insert to return a row");
    return row;
  }

  async function storedCategory(categoryId: string) {
    const db = getTestDb();
    return (
      await db
        .select({ icon: entryCategories.icon, description: entryCategories.description })
        .from(entryCategories)
        .where(eq(entryCategories.id, categoryId))
    )[0];
  }

  it("backfills only missing fields and reports wrote flags from the update", async () => {
    const category = await createCategory({ icon: "existing-icon" });

    const result = await updateMissingCategoryMetadata(ledgerId, category.id, {
      icon: "new-icon",
      description: "new-description",
      expectedName: category.name,
    });

    expect(result).toEqual({
      status: "updated",
      wroteIcon: false,
      wroteDescription: true,
    });
    const after = await storedCategory(category.id);
    expect(after?.icon).toBe("existing-icon");
    expect(after?.description).toBe("new-description");
  });

  it("is a no-op when nothing is missing", async () => {
    const category = await createCategory({ icon: "icon", description: "description" });

    const result = await updateMissingCategoryMetadata(ledgerId, category.id, {
      icon: "other-icon",
      description: "other-description",
      expectedName: category.name,
    });

    expect(result).toEqual({ status: "updated", wroteIcon: false, wroteDescription: false });
    const after = await storedCategory(category.id);
    expect(after).toMatchObject({ icon: "icon", description: "description" });
  });

  it("lets one concurrent backfill win without overwriting the other", async () => {
    const category = await createCategory();

    const [first, second] = await Promise.all([
      updateMissingCategoryMetadata(ledgerId, category.id, {
        icon: "icon-a",
        description: "description-a",
        expectedName: category.name,
      }),
      updateMissingCategoryMetadata(ledgerId, category.id, {
        icon: "icon-b",
        description: "description-b",
        expectedName: category.name,
      }),
    ]);

    // The statement is atomic per row: exactly one writer fills both fields;
    // the loser re-checks the missing-value predicates against the committed
    // row and updates nothing.
    const results = [first, second];
    expect(results.filter((result) => result.wroteIcon && result.wroteDescription)).toHaveLength(1);
    expect(results.filter((result) => !result.wroteIcon && !result.wroteDescription)).toHaveLength(
      1
    );

    const after = await storedCategory(category.id);
    if (after?.icon === "icon-a") {
      expect(after?.description).toBe("description-a");
    } else {
      expect(after?.icon).toBe("icon-b");
      expect(after?.description).toBe("description-b");
    }
  });
});
