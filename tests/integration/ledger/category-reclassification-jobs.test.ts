import { describe, expect, it } from "vitest";
import { categoryReclassificationJobs, ledgers } from "@/persistence";
import {
  getCategoryReclassificationJob,
  getLatestCategoryReclassificationJob,
} from "@/server/category-reclassification/jobs";
import { getTestDb } from "../../setup";
import { createLedgerData } from "../../helpers/factories";

describe("category assignment job reads", () => {
  it("reads current-format progress and scopes both lookup paths to the ledger", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    const other = { ...createLedgerData(), deletedAt: new Date() };
    await db.insert(ledgers).values([ledger, other]);
    const [job] = await db
      .insert(categoryReclassificationJobs)
      .values({
        ledgerId: ledger.id,
        mode: "clear",
        declaredEntryCount: 3,
        receivedEntryCount: 3,
        status: "succeeded",
        appliedCount: 3,
      })
      .returning();
    expect(
      await getCategoryReclassificationJob({ ledgerId: ledger.id, jobId: job!.id })
    ).toMatchObject({
      id: job!.id,
      declaredEntryCount: 3,
      mode: { kind: "clear" },
      appliedCount: 3,
    });
    expect(await getLatestCategoryReclassificationJob({ ledgerId: ledger.id })).toMatchObject({
      id: job!.id,
    });
    expect(await getCategoryReclassificationJob({ ledgerId: other.id, jobId: job!.id })).toBeNull();
    expect(await getLatestCategoryReclassificationJob({ ledgerId: other.id })).toBeNull();
  });
});
