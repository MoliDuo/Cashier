import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "../../setup";
import { ledgers, users } from "@/persistence";
import {
  configureTestCoupleLedger,
  createTestUser,
  TEST_PARTNER_USER_ID,
  TEST_USER_ID,
} from "../../helpers/schema-setup";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/auth";
import { updateMyProfileAction } from "@/modules/auth/server-actions/update-my-profile";
import { getCoupleMembersAction } from "@/modules/auth/server-actions/get-couple-members";

function mockSession(userId = TEST_USER_ID) {
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
    user: { id: userId, email: "member@example.com" },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  });
}

async function memberRows() {
  const rows = await getTestDb().select().from(users);
  return new Map(rows.map((row) => [row.id, row]));
}

describe("updateMyProfileAction", () => {
  let ledgerId: string;

  beforeEach(async () => {
    mockSession();
    const db = getTestDb();
    await db.delete(ledgers);
    await createTestUser(db, undefined, TEST_USER_ID);
    await createTestUser(db, undefined, TEST_PARTNER_USER_ID);
    ledgerId = crypto.randomUUID();
    await db.insert(ledgers).values({ id: ledgerId, userId: TEST_USER_ID });
    await configureTestCoupleLedger(db, ledgerId);
  });

  it("writes only the signed-in member's own row", async () => {
    const before = await memberRows();

    const saved = await updateMyProfileAction({
      nickname: "  Xiao Yu  ",
      gender: "female",
      timeZone: "Asia/Shanghai",
    });

    // The name is stored trimmed, and no other row moved.
    expect(saved).toEqual({
      id: TEST_USER_ID,
      nickname: "Xiao Yu",
      gender: "female",
      timeZone: "Asia/Shanghai",
    });
    const after = await memberRows();
    expect(after.get(TEST_PARTNER_USER_ID)).toEqual(before.get(TEST_PARTNER_USER_ID));
    expect(after.get(TEST_USER_ID)).toMatchObject({
      nickname: "Xiao Yu",
      gender: "female",
      timeZone: "Asia/Shanghai",
    });
  });

  it("lets each member keep their own zone", async () => {
    await updateMyProfileAction({ nickname: "A", gender: "male", timeZone: "Asia/Shanghai" });
    mockSession(TEST_PARTNER_USER_ID);
    await updateMyProfileAction({ nickname: "B", gender: "female", timeZone: "America/New_York" });

    const rows = await memberRows();
    expect(rows.get(TEST_USER_ID)?.timeZone).toBe("Asia/Shanghai");
    expect(rows.get(TEST_PARTNER_USER_ID)?.timeZone).toBe("America/New_York");
  });

  it("rejects an empty nickname, an unknown gender, and an invalid zone", async () => {
    await expect(
      updateMyProfileAction({ nickname: "   ", gender: "male", timeZone: null })
    ).rejects.toThrow(/Validation failed/);
    await expect(
      updateMyProfileAction({ nickname: "A", gender: "other" as "male", timeZone: null })
    ).rejects.toThrow(/Validation failed/);
    await expect(
      updateMyProfileAction({ nickname: "A", gender: "male", timeZone: "Mars/Olympus" })
    ).rejects.toThrow(/Validation failed/);
    expect((await memberRows()).get(TEST_USER_ID)?.nickname).toBe("A");
  });

  it("returns both members owner-first for the switch", async () => {
    await updateMyProfileAction({ nickname: "Alice", gender: "female", timeZone: null });
    mockSession(TEST_PARTNER_USER_ID);
    await updateMyProfileAction({ nickname: "Bob", gender: "male", timeZone: "UTC" });

    await expect(getCoupleMembersAction()).resolves.toEqual([
      { id: TEST_USER_ID, nickname: "Alice", gender: "female", timeZone: null },
      { id: TEST_PARTNER_USER_ID, nickname: "Bob", gender: "male", timeZone: "UTC" },
    ]);
  });
});
