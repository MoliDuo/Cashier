import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger, TEST_USER_ID } from "../../helpers/schema-setup";
import { getLedgerAction } from "@/modules/ledger/server-actions/get";
import { updateLedgerSettingsAction } from "@/modules/ledger/server-actions/update";
import { auth } from "@/auth";
import { eq } from "drizzle-orm";
import { ledgers } from "@/persistence";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

/**
 * One account and one live ledger, so "isolation" now means: whichever records
 * exist, a request for a ledger that is not the live one is refused, and the
 * live one is reachable. `ledgers.user_id` still records who created a row, but
 * it is no longer what access is decided from.
 */
describe("Multi-User Isolation", () => {
  let liveLedger: string;
  let otherLedger: string;

  beforeEach(async () => {
    const db = getTestDb();
    const created = await createTestUserWithLedger(db);
    liveLedger = created.ledgerId;
    // A retired ledger row: it exists, but it is not live, so the single-live-
    // ledger rule is what makes it unreachable rather than its owner.
    otherLedger = crypto.randomUUID();
    await db
      .insert(ledgers)
      .values({ id: otherLedger, userId: TEST_USER_ID, deletedAt: new Date() });
  });

  describe("Ledger Actions Isolation", () => {
    it("refuses a ledger that is not the single live one", async () => {
      (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        user: { id: TEST_USER_ID },
      });

      await expect(getLedgerAction(otherLedger)).resolves.toBeNull();
    });

    it("allows the live ledger", async () => {
      (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        user: { id: TEST_USER_ID },
      });

      const result = await getLedgerAction(liveLedger);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(liveLedger);
    });

    it("refuses to update a ledger that is not the live one", async () => {
      (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        user: { id: TEST_USER_ID },
      });

      const row = await getTestDb().query.ledgers.findFirst({
        where: eq(ledgers.id, otherLedger),
      });
      await expect(
        updateLedgerSettingsAction(otherLedger, {
          expectedUpdatedAt: row!.updatedAt.toISOString(),
          settings: { collapseEntriesDefault: true },
        })
      ).resolves.toMatchObject({ ok: false });
    });
  });
});
