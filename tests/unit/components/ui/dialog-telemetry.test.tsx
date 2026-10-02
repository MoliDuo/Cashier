import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const { trackDialogMock } = vi.hoisted(() => ({ trackDialogMock: vi.fn() }));

vi.mock("@/lib/telemetry/client", () => ({ trackDialog: trackDialogMock }));

function tree(open: boolean, name?: string, onOpenChange?: (open: boolean) => void) {
  return (
    <Dialog
      open={open}
      {...(name == null ? {} : { name })}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <DialogContent variant="modal" aria-describedby={undefined}>
        <DialogTitle>Review</DialogTitle>
      </DialogContent>
    </Dialog>
  );
}

describe("dialog telemetry", () => {
  beforeEach(() => trackDialogMock.mockReset());

  it("records nothing for a dialog without a name", () => {
    const view = render(tree(true));
    view.rerender(tree(false));

    expect(trackDialogMock).not.toHaveBeenCalled();
  });

  it("records open, then close by the action that closed it", () => {
    const view = render(tree(true, "period.picker"));
    expect(trackDialogMock.mock.calls).toEqual([["period.picker", "open"]]);

    view.rerender(tree(false, "period.picker"));

    expect(trackDialogMock).toHaveBeenLastCalledWith("period.picker", "close", "action");
  });

  it("records the close button, Escape and an outside press as such", async () => {
    const closed = (name: string) => {
      trackDialogMock.mockClear();
      const onOpenChange = vi.fn();
      const view = render(tree(true, name, onOpenChange));
      return { view, onOpenChange };
    };

    const byButton = closed("a");
    fireEvent.click(screen.getByRole("button", { name: /关闭|close/i }));
    byButton.view.rerender(tree(false, "a"));
    expect(trackDialogMock).toHaveBeenLastCalledWith("a", "close", "close_button");
    byButton.view.unmount();

    const byEscape = closed("b");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    byEscape.view.rerender(tree(false, "b"));
    expect(trackDialogMock).toHaveBeenLastCalledWith("b", "close", "escape");
    byEscape.view.unmount();

    const byOutside = closed("c");
    // Radix listens for outside presses from the next task on.
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(byOutside.onOpenChange).toHaveBeenCalledWith(false);
    byOutside.view.rerender(tree(false, "c"));
    expect(trackDialogMock).toHaveBeenLastCalledWith("c", "close", "outside");
  });

  it("records the close of a dialog that unmounts while open", () => {
    const view = render(tree(true, "period.picker"));

    view.unmount();

    expect(trackDialogMock).toHaveBeenLastCalledWith("period.picker", "close", "action");
  });
});
