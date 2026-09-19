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
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ replace: routerReplaceMock, refresh: routerRefreshMock }),
}));

import { SetupForm } from "@/modules/setup/ui/SetupForm";
import zh from "../../../../messages/zh.json";

const { weakPassword, wrongCode } = zh.Setup;
/** 100 ASCII characters: long enough in characters, too long for bcrypt. */
const TOO_MANY_BYTES = "a".repeat(99) + "1";
const LEGAL_PASSWORD = "setup-pass-1";

function fill(text: { setupCode?: string; email?: string; password?: string }) {
  if (text.setupCode !== undefined) {
    fireEvent.change(screen.getByLabelText(zh.Setup.setupCode), {
      target: { value: text.setupCode },
    });
  }
  if (text.email !== undefined) {
    fireEvent.change(screen.getByLabelText(zh.Setup.email), { target: { value: text.email } });
  }
  if (text.password !== undefined) {
    fireEvent.change(screen.getByLabelText(zh.Setup.password), {
      target: { value: text.password },
    });
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

  /**
   * The form used to check only the character count beside the server, so a
   * password the server refuses could be typed, submitted and answered with a
   * generic failure. The two now read one rule.
   */
  it("says why a password cannot work before anything is submitted", () => {
    render(<SetupForm />);

    fill({ password: TOO_MANY_BYTES });

    expect(alerts()).toEqual([weakPassword]);
    expect(completeSetupActionMock).not.toHaveBeenCalled();

    fill({ password: LEGAL_PASSWORD });

    expect(alerts()).toEqual([]);
  });

  it("refuses to submit a password the server would refuse", async () => {
    const user = userEvent.setup();
    render(<SetupForm />);
    fill({ setupCode: "12345678", email: "owner@example.com", password: TOO_MANY_BYTES });

    await user.click(screen.getByRole("button", { name: zh.Setup.submit }));

    // No round trip: the same rule the action applies already answered. The
    // inline hint and the form's own message say the same thing, and nothing
    // else is on screen to mislead the reader.
    expect(completeSetupActionMock).not.toHaveBeenCalled();
    expect(alerts().filter((text) => text !== weakPassword)).toEqual([]);
    expect(alerts().length).toBeGreaterThan(0);
  });

  it("submits the account, the books and the locale once the password passes", async () => {
    const user = userEvent.setup();
    render(<SetupForm />);
    fill({ setupCode: "12345678", email: "owner@example.com", password: LEGAL_PASSWORD });

    await user.click(screen.getByRole("button", { name: zh.Setup.submit }));

    await waitFor(() => expect(completeSetupActionMock).toHaveBeenCalledTimes(1));
    expect(completeSetupActionMock).toHaveBeenCalledWith({
      setupCode: "12345678",
      email: "owner@example.com",
      password: LEGAL_PASSWORD,
      locale: "zh",
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
    fill({ setupCode: "12345678", email: "owner@example.com", password: LEGAL_PASSWORD });

    await user.click(screen.getByRole("button", { name: zh.Setup.submit }));

    await waitFor(() => expect(alerts()).toEqual([wrongCode]));
    expect(routerReplaceMock).not.toHaveBeenCalled();
    // The attempt is over, not the form: the button is usable again.
    expect(screen.getByRole("button", { name: zh.Setup.submit })).toBeEnabled();
  });
});
