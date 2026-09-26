import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";

const { sonnerMock } = vi.hoisted(() => ({ sonnerMock: vi.fn() }));

vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("sonner", () => ({
  Toaster: (props: unknown) => {
    sonnerMock(props);
    return <div data-testid="sonner" />;
  },
}));

describe("Toaster", () => {
  it("keeps mobile notifications compact and below the safe area", () => {
    render(<Toaster position="top-center" />);

    expect(sonnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        position: "top-center",
        visibleToasts: 2,
        mobileOffset: {
          top: "calc(env(safe-area-inset-top) + 12px)",
          right: 16,
          bottom: "calc(env(safe-area-inset-bottom) + 12px)",
          left: 16,
        },
      })
    );
    expect(sonnerMock.mock.calls[0]?.[0]).not.toHaveProperty("expand");
  });
});
