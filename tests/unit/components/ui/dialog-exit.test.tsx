import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

describe("dialog exit", () => {
  it("completes exit without a CSS animation event", async () => {
    const exited = vi.fn();
    const closedFocus = vi.fn();
    const content = (open: boolean) => (
      <Dialog open={open}>
        <DialogContent
          variant="modal"
          aria-describedby={undefined}
          onExitComplete={exited}
          onCloseAutoFocus={closedFocus}
        >
          <DialogTitle>Review</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    const view = render(content(true));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(exited).not.toHaveBeenCalled();
    view.rerender(content(false));
    await waitFor(() => expect(exited).toHaveBeenCalledTimes(1));
    expect(closedFocus).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
