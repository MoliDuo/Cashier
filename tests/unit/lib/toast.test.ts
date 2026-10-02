import { beforeEach, describe, expect, it, vi } from "vitest";

const { sonner, trackMock } = vi.hoisted(() => ({
  sonner: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  trackMock: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: sonner }));
vi.mock("@/lib/telemetry/client", () => ({ track: trackMock }));

import { toast } from "@/lib/toast";

describe("toast", () => {
  beforeEach(() => {
    Object.values(sonner).forEach((mock) => mock.mockReset().mockReturnValue("toast-id"));
    trackMock.mockReset();
  });

  it.each(["success", "error", "warning"] as const)(
    "shows a %s toast as sonner does and records its level only",
    (level) => {
      const id = toast[level]("Saved receipt-from-Cafe-Moli.jpg", { id: "x", duration: 10 });

      expect(sonner[level]).toHaveBeenCalledWith("Saved receipt-from-Cafe-Moli.jpg", {
        id: "x",
        duration: 10,
      });
      expect(id).toBe("toast-id");
      expect(trackMock).toHaveBeenCalledWith("$toast", { level });
      expect(JSON.stringify(trackMock.mock.calls)).not.toContain("Cafe");
    }
  );

  it("passes a message alone through without an options argument", () => {
    toast.error("Failed");

    expect(sonner.error).toHaveBeenCalledWith("Failed");
  });
});
