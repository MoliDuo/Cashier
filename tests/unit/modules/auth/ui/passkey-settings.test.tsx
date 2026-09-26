import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { PasskeySettings } from "@/modules/auth/ui/PasskeySettings";

const fetchPasskeys = vi.hoisted(() => vi.fn());
const actions = vi.hoisted(() => ({
  startPasskeyRegistrationAction: vi.fn(),
  finishPasskeyRegistrationAction: vi.fn(),
  renamePasskeyAction: vi.fn(),
  deletePasskeyAction: vi.fn(),
}));
const browser = vi.hoisted(() => ({ supported: true, startRegistration: vi.fn() }));

vi.mock("@/modules/auth/server-actions/passkeys", () => actions);
vi.mock("@/modules/auth/queries", () => ({ fetchPasskeys }));
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => browser.supported,
  startRegistration: browser.startRegistration,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const laptop = {
  id: "cred-1",
  name: "笔记本",
  createdAt: "2026-01-02T03:04:05.000Z",
  lastUsedAt: null,
  backedUp: true,
};

function renderSettings(onRequireReauthentication = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<PasskeySettings onRequireReauthentication={onRequireReauthentication} />, { wrapper });
  return { onRequireReauthentication };
}

async function addPasskey(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "添加通行密钥" }));
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: name } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
  });
}

describe("PasskeySettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browser.supported = true;
    fetchPasskeys.mockResolvedValue([laptop]);
    actions.startPasskeyRegistrationAction.mockResolvedValue({
      ok: true,
      challengeId: "challenge",
      options: { challenge: "c" },
    });
    browser.startRegistration.mockResolvedValue({ id: "cred-2" });
  });

  it("registers a named passkey and lists it without a reload", async () => {
    actions.finishPasskeyRegistrationAction.mockResolvedValue({
      ok: true,
      passkey: { ...laptop, id: "cred-2", name: "手机" },
    });
    renderSettings();
    expect(await screen.findByText("笔记本")).toBeInTheDocument();

    await addPasskey("手机");

    expect(browser.startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: "c" } });
    expect(actions.finishPasskeyRegistrationAction).toHaveBeenCalledWith(
      "challenge",
      { id: "cred-2" },
      "手机"
    );
    expect(await screen.findByText("手机")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("已添加通行密钥");
  });

  it("asks for a fresh sign-in when the session is too old to add one", async () => {
    actions.startPasskeyRegistrationAction.mockResolvedValue({
      ok: false,
      code: "reauth_required",
    });
    const { onRequireReauthentication } = renderSettings();
    await screen.findByText("笔记本");

    await addPasskey("手机");

    expect(onRequireReauthentication).toHaveBeenCalledOnce();
    expect(browser.startRegistration).not.toHaveBeenCalled();
  });

  it("stays quiet when the browser prompt is dismissed", async () => {
    browser.startRegistration.mockRejectedValue(
      Object.assign(new Error("cancelled"), { name: "NotAllowedError" })
    );
    renderSettings();
    await screen.findByText("笔记本");

    await addPasskey("手机");

    expect(actions.finishPasskeyRegistrationAction).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("warns that deleting the last passkey leaves only email codes", async () => {
    actions.deletePasskeyAction.mockResolvedValue({ ok: true });
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "删除 笔记本" }));

    expect(
      screen.getByText("这是最后一个通行密钥。删除后只能用邮箱验证码登录。")
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "删除" }));
    });

    expect(actions.deletePasskeyAction).toHaveBeenCalledWith("cred-1");
    await waitFor(() => expect(screen.queryByText("笔记本")).not.toBeInTheDocument());
    expect(screen.getByText("还没有通行密钥，目前只能用邮箱验证码登录。")).toBeInTheDocument();
  });

  it("renames a passkey in place", async () => {
    actions.renamePasskeyAction.mockResolvedValue({ ok: true });
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "重命名 笔记本" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "工作电脑" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
    });

    expect(actions.renamePasskeyAction).toHaveBeenCalledWith("cred-1", "工作电脑");
    expect(await screen.findByText("工作电脑")).toBeInTheDocument();
  });

  it("disables adding where the browser has no WebAuthn", async () => {
    browser.supported = false;
    renderSettings();

    expect(await screen.findByText("当前浏览器不支持通行密钥。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加通行密钥" })).toBeDisabled();
  });
});
