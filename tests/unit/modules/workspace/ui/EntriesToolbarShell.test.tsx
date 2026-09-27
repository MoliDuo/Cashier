import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EntriesToolbarShell } from "@/modules/workspace/ui/EntriesToolbarShell";

describe("EntriesToolbarShell", () => {
  it("carries the browsing controls and the total", () => {
    render(
      <EntriesToolbarShell totalLabel="¥12.00">
        <span>filters</span>
      </EntriesToolbarShell>
    );

    expect(screen.getByText("filters")).toBeInTheDocument();
    expect(screen.getByText("¥12.00")).toBeInTheDocument();
  });

  it("offers no refresh of its own", () => {
    render(<EntriesToolbarShell totalLabel="¥12.00">{null}</EntriesToolbarShell>);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
