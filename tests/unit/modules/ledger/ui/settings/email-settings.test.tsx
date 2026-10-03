import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { EmailSettings } from "@/modules/ledger/ui/settings/EmailSettings";

const { fetchLoginEmails, addLoginEmailAction, removeLoginEmailAction } = vi.hoisted(() => ({
  fetchLoginEmails: vi.fn(),
  addLoginEmailAction: vi.fn(),
  removeLoginEmailAction: vi.fn(),
}));

vi.mock("@/modules/auth/queries", () => ({ fetchLoginEmails: fetchLoginEmails }));
vi.mock("@/modules/auth/server-actions/login-emails", () => ({
  addLoginEmailAction,
  removeLoginEmailAction,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderEmailSettings(
  props: Partial<React.ComponentProps<typeof EmailSettings>> = {},
  handlers: { onAllSessionsEnded?: () => void | Promise<void> } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<EmailSettings userEmail="me@example.com" {...handlers} {...props} />, { wrapper });
}

async function addEmail(address: string) {
  fireEvent.click(screen.getByRole("button", { name: "添加邮箱" }));
  fireEvent.change(screen.getByLabelText("新邮箱地址"), { target: { value: address } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
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

  it("adds an email without any code and refreshes the list instead of ending sessions", async () => {
    addLoginEmailAction.mockResolvedValue({
      ok: true,
      emails: ["me@example.com", "new@example.com"],
    });
    const onAllSessionsEnded = vi.fn();
    renderEmailSettings({}, { onAllSessionsEnded });
    await waitFor(() => expect(fetchLoginEmails).toHaveBeenCalled());
    await act(async () => {});

    await addEmail("new@example.com");

    expect(addLoginEmailAction).toHaveBeenCalledWith("new@example.com");
    expect(await screen.findByText("new@example.com")).toBeInTheDocument();
    expect(onAllSessionsEnded).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("已添加邮箱");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the dialog open and says why an address is refused", async () => {
    addLoginEmailAction.mockResolvedValue({ ok: false, code: "email_in_use" });
    renderEmailSettings();

    await addEmail("taken@example.com");

    expect(await screen.findByRole("alert")).toHaveTextContent("该邮箱已被使用。");
    expect(toast.error).toHaveBeenCalledWith("该邮箱已被使用。");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("clears the pending flag when adding throws", async () => {
    addLoginEmailAction.mockRejectedValue(new Error("offline"));
    renderEmailSettings();

    await addEmail("new@example.com");

    await waitFor(() => expect(screen.getByRole("button", { name: "添加" })).toBeEnabled());
    expect(toast.error).toHaveBeenCalledWith("出了点问题，请重试。");
  });

  it("announces that every session ended before signing out after a removal", async () => {
    fetchLoginEmails.mockResolvedValue(["me@example.com", "other@example.com"]);
    removeLoginEmailAction.mockResolvedValue({ ok: true, emails: ["me@example.com"] });
    const onAllSessionsEnded = vi.fn();
    renderEmailSettings({}, { onAllSessionsEnded });

    fireEvent.click(await screen.findByRole("button", { name: "移除 other@example.com" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "移除" }));
    });

    await waitFor(() => expect(onAllSessionsEnded).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith("邮箱已移除，所有设备均已退出登录。");
    expect(screen.queryByText("other@example.com")).not.toBeInTheDocument();
  });

  it("reports a refused removal and stays signed in", async () => {
    fetchLoginEmails.mockResolvedValue(["me@example.com", "other@example.com"]);
    removeLoginEmailAction.mockResolvedValue({ ok: false, code: "last_email" });
    const onAllSessionsEnded = vi.fn();
    renderEmailSettings({}, { onAllSessionsEnded });

    fireEvent.click(await screen.findByRole("button", { name: "移除 other@example.com" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "移除" }));
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("账户至少要保留一个登录邮箱。"));
    expect(onAllSessionsEnded).not.toHaveBeenCalled();
  });
});
