import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { commonCopy } from "@/copy/common";

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogClose: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

describe("ConfirmDialog", () => {
  it("closes on commit before refresh finishes and ignores a duplicate click", async () => {
    let finish!: () => void;
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn((onCommitted: () => void) => {
      onCommitted();
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    render(
      <ConfirmDialog
        title="Delete"
        description="Delete item"
        open
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />
    );
    const button = screen.getByRole("button", { name: commonCopy.confirm });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(onConfirm).toHaveBeenCalledOnce();
    finish();
    await waitFor(() => expect(button).toBeEnabled());
    expect(onOpenChange).toHaveBeenCalledOnce();
  });

  it("retains the confirmation on mutation failure", async () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        title="Delete"
        description="Delete item"
        open
        onConfirm={async () => {
          throw new Error("failed");
        }}
        onOpenChange={onOpenChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: commonCopy.confirm }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: commonCopy.confirm })).toBeEnabled()
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });
  it("stays open and disables its action until an async confirmation succeeds", async () => {
    let resolveConfirmation!: () => void;
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirmation = resolve;
        })
    );
    render(
      <ConfirmDialog
        title="Delete"
        description="Delete this item"
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />
    );

    const confirmButton = screen.getByRole("button", { name: commonCopy.confirm });
    fireEvent.click(confirmButton);
    await waitFor(() => expect(confirmButton).toBeDisabled());
    expect(onOpenChange).not.toHaveBeenCalled();

    resolveConfirmation();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("stays open when saving unsaved changes fails", async () => {
    const onOpenChange = vi.fn();
    const onSave = vi.fn(async () => false);

    render(
      <ConfirmDialog
        title="Unsaved changes"
        description="Choose what to do"
        onConfirm={() => {}}
        onOpenChange={onOpenChange}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: commonCopy.save }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
