import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddLedgerEntryDialog } from "@/modules/source-document/ui/AddLedgerEntryDialog";

describe("AddLedgerEntryDialog", () => {
  it("preserves entered values when submission is not successful", async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);

    render(
      <AddLedgerEntryDialog
        open
        categories={[]}
        isSubmitting={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    const nameInput = screen.getByLabelText("名称");
    const amountInput = screen.getByLabelText("金额");
    fireEvent.change(nameInput, { target: { value: "Lunch" } });
    fireEvent.change(amountInput, { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "添加明细" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(nameInput).toHaveValue("Lunch");
    expect(amountInput).toHaveValue("12.50");
  });

  it("clears and closes only after a successful submission", async () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue(true);

    render(
      <AddLedgerEntryDialog
        open
        categories={[]}
        isSubmitting={false}
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
      />
    );

    const nameInput = screen.getByLabelText("名称");
    const amountInput = screen.getByLabelText("金额");
    fireEvent.change(nameInput, { target: { value: "Lunch" } });
    fireEvent.change(amountInput, { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "添加明细" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(nameInput).toHaveValue("");
    expect(amountInput).toHaveValue("");
  });

  it("submits an optional note with the entry", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);

    render(
      <AddLedgerEntryDialog
        open
        categories={[]}
        isSubmitting={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Lunch" } });
    fireEvent.change(screen.getByLabelText("备注（可选）"), { target: { value: " 加蛋 " } });
    fireEvent.change(screen.getByLabelText("金额"), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "添加明细" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ description: "加蛋" }))
    );
  });
});
