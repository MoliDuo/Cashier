import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

describe("Dialog", () => {
  it("renders the shared close screen-reader text", () => {
    render(
      <Dialog open>
        <DialogTrigger />
        <DialogContent variant="modal">
          <p>Dialog body</p>
        </DialogContent>
      </Dialog>
    );

    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });

  it("focuses the dialog title before its close control", async () => {
    render(
      <Dialog open>
        <DialogContent variant="modal">
          <DialogTitle>Dialog title</DialogTitle>
          <p>Dialog body</p>
        </DialogContent>
      </Dialog>
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Dialog title" })).toHaveFocus()
    );
    expect(screen.getByRole("button", { name: "关闭" })).not.toHaveFocus();
  });

  it("increments the layer for a nested task dialog", () => {
    render(
      <Dialog open>
        <DialogContent variant="detail">
          <p>Detail body</p>
          <Dialog open>
            <DialogContent variant="modal">
              <p>Task body</p>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>
    );

    const detail = screen.getByText("Detail body").parentElement;
    const task = screen.getByText("Task body").parentElement;
    expect(Number(task?.style.zIndex)).toBeGreaterThan(Number(detail?.style.zIndex));
  });
});
