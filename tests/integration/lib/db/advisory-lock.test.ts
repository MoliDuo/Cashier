import { describe, expect, it } from "vitest";
import { withAdvisoryLock } from "@/lib/db/advisory-lock";

const KEY = 424242;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("withAdvisoryLock", () => {
  it("runs the work and returns its value when nobody holds the lock", async () => {
    await expect(withAdvisoryLock(KEY, async () => "done")).resolves.toEqual({
      ran: true,
      value: "done",
    });
  });

  it("skips the work while another session holds the lock", async () => {
    const release = deferred();
    const entered = deferred();
    const holder = withAdvisoryLock(KEY, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;

    let ranSecond = false;
    const second = await withAdvisoryLock(KEY, async () => {
      ranSecond = true;
    });

    expect(second).toEqual({ ran: false });
    expect(ranSecond).toBe(false);
    release.resolve();
    await holder;
  });

  it("releases the lock after the work, including when it throws", async () => {
    await expect(
      withAdvisoryLock(KEY, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    await expect(withAdvisoryLock(KEY, async () => 1)).resolves.toEqual({ ran: true, value: 1 });
  });

  it("does not block a different key", async () => {
    const release = deferred();
    const entered = deferred();
    const holder = withAdvisoryLock(KEY, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;

    await expect(withAdvisoryLock(KEY + 1, async () => "other")).resolves.toEqual({
      ran: true,
      value: "other",
    });
    release.resolve();
    await holder;
  });
});
