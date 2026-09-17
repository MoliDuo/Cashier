import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberScopeReveal } from "@/modules/workspace/ui/MemberScopeReveal";
import { useMemberScopeRevealStore } from "@/lib/store/member-scope-reveal";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values == null ? key : `${key}:${Object.values(values).join(",")}`,
}));

function renderReveal(scope: "all" | "mine" | "partner" = "all", onScopeChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemberScopeReveal
        scope={scope}
        onScopeChange={onScopeChange}
        myNickname="Alice"
        partnerNickname="Bob"
      />
    </QueryClientProvider>
  );
  return { onScopeChange };
}

describe("MemberScopeReveal", () => {
  beforeEach(() => {
    useMemberScopeRevealStore.setState({ open: false });
  });

  it("labels the options from the two nicknames, not from the member ids", () => {
    renderReveal();

    const group = screen.getByRole("group", { name: "label" });
    const labels = [...group.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toEqual(["mine:Alice", "Bob", "allMembers"]);
  });

  it("stays out of the tab order while it is closed", () => {
    renderReveal();

    expect(screen.getByTestId("member-scope-reveal")).toHaveAttribute("inert");
    expect(screen.getByTestId("member-scope-reveal")).toHaveAttribute("data-pull-reveal", "closed");
  });

  it("reports the picked member and closes the strip once the press is visible", async () => {
    const user = userEvent.setup();
    const { onScopeChange } = renderReveal("all");
    act(() => useMemberScopeRevealStore.getState().setOpen(true));

    await waitFor(() =>
      expect(screen.getByTestId("member-scope-reveal")).toHaveAttribute("data-pull-reveal", "open")
    );
    await user.click(screen.getByRole("button", { name: "Bob" }));

    expect(onScopeChange).toHaveBeenCalledWith("partner");
    await waitFor(() =>
      expect(screen.getByTestId("member-scope-reveal")).toHaveAttribute(
        "data-pull-reveal",
        "closed"
      )
    );
  });

  it("leaves the scope alone when the current member is picked again", async () => {
    const user = userEvent.setup();
    const { onScopeChange } = renderReveal("partner");
    act(() => useMemberScopeRevealStore.getState().setOpen(true));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Bob" })).toHaveAttribute("aria-pressed", "true")
    );
    await user.click(screen.getByRole("button", { name: "Bob" }));

    expect(onScopeChange).not.toHaveBeenCalled();
  });
});
