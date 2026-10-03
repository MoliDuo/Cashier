import { describe, expect, it, vi } from "vitest";
import { createDailyScheduler } from "@/server/background/scheduler";

describe("daily scheduler lock", () => {
  it("lets only one of two processes sweep at the same time", async () => {
    const release = Promise.withResolvers<void>();
    const sweep = vi.fn(async () => {
      await release.promise;
      return {} as never;
    });
    const first = createDailyScheduler({ bootDelayMs: 0, sweep });
    const second = createDailyScheduler({ bootDelayMs: 0, sweep });

    first.start();
    second.start();
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sweep).toHaveBeenCalledTimes(1);

    release.resolve();
    await Promise.all([first.stop(), second.stop()]);
  });
});
