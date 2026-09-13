import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessingStatus } from "@/modules/source-document/ui/processing-status";
import { SourceDocumentImageModal } from "@/modules/source-document/ui/SourceDocumentImageModal";

function ImageDialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open images
      </button>
      <SourceDocumentImageModal
        images={[
          { data: "data:image/png;base64,AA==", mimeType: "image/png" },
          { data: "data:image/png;base64,AQ==", mimeType: "image/png" },
        ]}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

describe("source document accessibility", () => {
  let reducedMotion = false;

  beforeEach(() => {
    reducedMotion = false;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: reducedMotion,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("announces processing, failure, and success state changes", () => {
    const { rerender } = render(<ProcessingStatus status="processing" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");

    rerender(<ProcessingStatus status="error" />);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");

    rerender(<ProcessingStatus status="completed" />);
    expect(screen.getByRole("status")).toHaveTextContent(/completed|完成/i);

    rerender(<ProcessingStatus status="error" label="Parsing failed" />);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
  });

  it("keeps naming the state in words now that the card paints it instead", () => {
    // The surface carries the state and the band of light is decoration, so the
    // live region is the only place the state is actually said.
    const { rerender } = render(<ProcessingStatus status="processing" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("status")).toHaveTextContent(/处理中|Processing/i);

    rerender(<ProcessingStatus status="cancelled" />);
    expect(screen.getByRole("status")).toHaveTextContent(/已取消|Cancelled/i);
  });

  it("prints a failure's reason and nothing else on the card", () => {
    render(<ProcessingStatus status="error" label="无法解析" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveTextContent("无法解析");
    expect(screen.queryByText(/Error/i)).not.toBeInTheDocument();
  });

  it("supports keyboard image navigation, Escape dismissal, and focus return", async () => {
    const user = userEvent.setup();
    render(<ImageDialogHarness />);
    const trigger = screen.getByRole("button", { name: "Open images" });
    trigger.focus();
    await user.click(trigger);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next image|下一张图片/i })).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("heading", { name: /2\/2/ })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
