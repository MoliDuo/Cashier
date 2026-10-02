import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GlobalError from "@/app/error";

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));

vi.mock("@/lib/telemetry/client", () => ({ track: trackMock }));

const originalLocation = window.location;

describe("error boundary retry buttons", () => {
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reloadMock = vi.fn();
    trackMock.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, reload: reloadMock },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
    vi.restoreAllMocks();
  });

  it("hard-refreshes from the global error page instead of calling reset", () => {
    const reset = vi.fn();
    render(<GlobalError error={new Error("boom")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("records the boundary as an $error with its type and digest, never its message", () => {
    const error = Object.assign(new TypeError("amount 12.50 at Cafe Moli"), { digest: "d1g3st" });
    render(<GlobalError error={error} reset={vi.fn()} />);

    expect(trackMock).toHaveBeenCalledWith("$error", {
      kind: "boundary",
      source: "app/error",
      name: "TypeError",
      digest: "d1g3st",
    });
    expect(JSON.stringify(trackMock.mock.calls)).not.toContain("Cafe");
  });
});
