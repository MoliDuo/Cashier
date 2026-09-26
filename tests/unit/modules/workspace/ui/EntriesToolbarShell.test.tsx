import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EntriesToolbarShell } from "@/modules/workspace/ui/EntriesToolbarShell";

describe("EntriesToolbarShell", () => {
  it("carries the browsing controls with the range and its total", () => {
    render(
      <EntriesToolbarShell rangeLabel="本月" totalLabel="¥12.00" syncStatus={<span>synced</span>}>
        <span>filters</span>
      </EntriesToolbarShell>
    );

    expect(screen.getByText("filters")).toBeInTheDocument();
    expect(screen.getByText("本月")).toBeInTheDocument();
    expect(screen.getByText("¥12.00")).toBeInTheDocument();
    expect(screen.getByTestId("toolbar-sync-status")).toHaveTextContent("synced");
  });

  it("offers no refresh of its own, because the tab bar owns that gesture", () => {
    render(<EntriesToolbarShell totalLabel="¥12.00">{null}</EntriesToolbarShell>);

    expect(screen.queryByTestId("toolbar-refresh-hint")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
