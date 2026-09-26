import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { completeSetupActionMock, routerReplaceMock, routerRefreshMock } = vi.hoisted(() => ({
  completeSetupActionMock: vi.fn(),
  routerReplaceMock: vi.fn(),
  routerRefreshMock: vi.fn(),
}));

vi.mock("@/modules/setup/server-actions/setup", () => ({
  completeSetupAction: completeSetupActionMock,
}));

// The shared setup stands in for `Link` only, and the wizard navigates once it
// succeeds, so the router is replaced here as well.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock, refresh: routerRefreshMock }),
}));

import { SetupForm } from "@/modules/setup/ui/SetupForm";
import zh from "../../../../messages/zh.json";

const { wrongCode } = zh.Setup;

function fill(text: { setupCode?: string; email?: string }) {
  if (text.setupCode !== undefined) {
    fireEvent.change(screen.getByLabelText(zh.Setup.setupCode), {
      target: { value: text.setupCode },
    });
  }
  if (text.email !== undefined) {
    fireEvent.change(screen.getByLabelText(zh.Setup.email), { target: { value: text.email } });
  }
}

function alerts(): string[] {
  return screen.queryAllByRole("alert").map((node) => node.textContent ?? "");
}

describe("SetupForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeSetupActionMock.mockResolvedValue({ ok: true, ledgerId: "ledger-1" });
  });

  it("asks for no password: the account signs in with a code and then a passkey", () => {
    render(<SetupForm />);

    expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByText(zh.Setup.emailDesc)).toBeInTheDocument();
  });

  it("submits the setup code, the login email and the books", async () => {
    const user = userEvent.setup();
    render(<SetupForm />);
    fill({ setupCode: "12345678", email: "owner@example.com" });

    await user.click(screen.getByRole("button", { name: zh.Setup.submit }));

    await waitFor(() => expect(completeSetupActionMock).toHaveBeenCalledTimes(1));
    expect(completeSetupActionMock).toHaveBeenCalledWith({
      setupCode: "12345678",
      email: "owner@example.com",
      books: [zh.Setup.sharedBookName],
    });
    await waitFor(() =>
      expect(routerReplaceMock).toHaveBeenCalledWith("/login?notice=setup_complete")
    );
    expect(routerRefreshMock).toHaveBeenCalled();
  });

  it("shows the reason the server refused the code and lets the reader try again", async () => {
    const user = userEvent.setup();
    completeSetupActionMock.mockResolvedValue({ ok: false, code: "wrong_code" });
    render(<SetupForm />);
    fill({ setupCode: "12345678", email: "owner@example.com" });

    await user.click(screen.getByRole("button", { name: zh.Setup.submit }));

    await waitFor(() => expect(alerts()).toEqual([wrongCode]));
    expect(routerReplaceMock).not.toHaveBeenCalled();
    // The attempt is over, not the form: the button is usable again.
    expect(screen.getByRole("button", { name: zh.Setup.submit })).toBeEnabled();
  });
});
