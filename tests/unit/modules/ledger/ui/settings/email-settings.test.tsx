import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { EmailSettings } from "@/modules/ledger/ui/settings/EmailSettings";

const {
  fetchLoginEmails,
  removeLoginEmailAction,
  sendLoginEmailCodeAction,
  verifyLoginEmailCodeAction,
} = vi.hoisted(() => ({
  fetchLoginEmails: vi.fn(),
  removeLoginEmailAction: vi.fn(),
  sendLoginEmailCodeAction: vi.fn(),
  verifyLoginEmailCodeAction: vi.fn(),
}));

vi.mock("@/modules/auth/queries", () => ({ fetchLoginEmails: fetchLoginEmails }));
vi.mock("@/modules/auth/server-actions/login-emails", () => ({
  removeLoginEmailAction,
  sendLoginEmailCodeAction,
  verifyLoginEmailCodeAction,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderEmailSettings(
  props: Partial<React.ComponentProps<typeof EmailSettings>> = {},
  handlers: {
    onRequireReauthentication?: () => void | Promise<void>;
    onAllSessionsEnded?: () => void | Promise<void>;
  } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<EmailSettings userEmail="me@example.com" {...handlers} {...props} />, { wrapper });
}

async function addEmail(address: string, code: string) {
  fireEvent.click(screen.getByRole("button", { name: "添加邮箱" }));
  fireEvent.change(screen.getByLabelText("新邮箱地址"), { target: { value: address } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
  });
  fireEvent.change(await screen.findByLabelText("6 位验证码"), { target: { value: code } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
  });
}

describe("EmailSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchLoginEmails.mockResolvedValue(["me@example.com"]);
  });

  it("lists every login email of the account, not only the signed-in one", async () => {
    fetchLoginEmails.mockResolvedValue(["me@example.com", "other@example.com"]);
    renderEmailSettings();

    expect(await screen.findByText("other@example.com")).toBeInTheDocument();
    const removals = screen.getAllByRole("button", { name: /^移除 / });
    expect(removals).toHaveLength(2);
    for (const removal of removals) expect(removal).toBeEnabled();
  });

  it("keeps the one remaining email's removal disabled", async () => {
    renderEmailSettings();

    await waitFor(() => expect(screen.getByRole("button", { name: /^移除 / })).toBeDisabled());
  });

  it("refreshes the list after adding an email instead of ending sessions", async () => {
    sendLoginEmailCodeAction.mockResolvedValue({ ok: true, expiresAt: Date.now() });
    verifyLoginEmailCodeAction.mockResolvedValue({
      ok: true,
      emails: ["me@example.com", "new@example.com"],
      verified: true,
    });
    const onAllSessionsEnded = vi.fn();
    renderEmailSettings({}, { onAllSessionsEnded });

    await addEmail("new@example.com", "123456");

    expect(await screen.findByText("new@example.com")).toBeInTheDocument();
    expect(onAllSessionsEnded).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("已添加邮箱");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("clears the pending flag when sending a code throws", async () => {
    sendLoginEmailCodeAction.mockRejectedValue(new Error("offline"));
    renderEmailSettings();

    fireEvent.click(screen.getByRole("button", { name: "添加邮箱" }));
    fireEvent.change(screen.getByLabelText("新邮箱地址"), {
      target: { value: "new@example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "发送验证码" })).toBeEnabled());
    expect(toast.error).toHaveBeenCalledWith("出了点问题，请重试。");
  });

  it("clears the pending flag when verification throws", async () => {
    sendLoginEmailCodeAction.mockResolvedValue({ ok: true, expiresAt: Date.now() });
    verifyLoginEmailCodeAction.mockRejectedValue(new Error("offline"));
    renderEmailSettings();

    await addEmail("new@example.com", "123456");

    await waitFor(() => expect(screen.getByRole("button", { name: "确认" })).toBeEnabled());
    expect(toast.error).toHaveBeenCalledWith("出了点问题，请重试。");
  });

  it("routes a re-auth requirement on verify into the re-auth flow", async () => {
    sendLoginEmailCodeAction.mockResolvedValue({ ok: true, expiresAt: Date.now() });
    verifyLoginEmailCodeAction.mockResolvedValue({ ok: false, code: "reauth_required" });
    const onRequireReauthentication = vi.fn();
    const onAllSessionsEnded = vi.fn();
    renderEmailSettings({}, { onRequireReauthentication, onAllSessionsEnded });

    await addEmail("new@example.com", "123456");

    await waitFor(() => expect(onRequireReauthentication).toHaveBeenCalledTimes(1));
    expect(onAllSessionsEnded).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("announces that every session ended before signing out after a removal", async () => {
    fetchLoginEmails.mockResolvedValue(["me@example.com", "other@example.com"]);
    removeLoginEmailAction.mockResolvedValue({ ok: true, emails: ["me@example.com"] });
    const onAllSessionsEnded = vi.fn();
    renderEmailSettings({}, { onAllSessionsEnded });

    fireEvent.click(await screen.findByRole("button", { name: "移除 other@example.com" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    });

    await waitFor(() => expect(onAllSessionsEnded).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith("邮箱已移除，所有设备均已退出登录。");
    expect(screen.queryByText("other@example.com")).not.toBeInTheDocument();
  });

  it("routes a re-auth requirement on removal into the re-auth flow", async () => {
    fetchLoginEmails.mockResolvedValue(["me@example.com", "other@example.com"]);
    removeLoginEmailAction.mockResolvedValue({ ok: false, code: "reauth_required" });
    const onRequireReauthentication = vi.fn();
    const onAllSessionsEnded = vi.fn();
    renderEmailSettings({}, { onRequireReauthentication, onAllSessionsEnded });

    fireEvent.click(await screen.findByRole("button", { name: "移除 other@example.com" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    });

    await waitFor(() => expect(onRequireReauthentication).toHaveBeenCalledTimes(1));
    expect(onAllSessionsEnded).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
