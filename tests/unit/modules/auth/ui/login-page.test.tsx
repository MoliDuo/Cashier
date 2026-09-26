import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const searchState = vi.hoisted(() => ({ query: "" }));

const mockUseLoginFlow = vi.hoisted(() =>
  vi.fn((options?: { isDevAuthAvailable?: boolean }) => ({
    passkeySupported: false,
    handlePasskeyLogin: vi.fn(),
    callbackUrl: "/",
    step: "email" as "email" | "otp",
    email: "",
    otp: "",
    isLoading: false,
    error: null as string | null,
    expiresAt: null,
    canResendAt: null,
    resendPending: false,
    otpExpired: false,
    isDevAuthAvailable: options?.isDevAuthAvailable ?? false,
    setEmail: vi.fn(),
    setOtp: vi.fn(),
    handleSendOTP: vi.fn(),
    handleVerifyOTP: vi.fn(),
    handleResendOTP: vi.fn(),
    handleChangeEmail: vi.fn(),
    handleOTPExpired: vi.fn(),
    handleDevSignIn: vi.fn(),
  }))
);

type Flow = ReturnType<typeof mockUseLoginFlow>;

const flowWith = (overrides: Partial<Flow>) => ({ ...mockUseLoginFlow(), ...overrides });

vi.mock("@/modules/auth/hooks/use-login-flow", () => ({
  useLoginFlow: mockUseLoginFlow,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchState.query),
}));

describe("AuthLoginPage", () => {
  it("asks for an email address to send a code to, with no password field", async () => {
    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage emailAuthEnabled />);

    expect(screen.getByLabelText("邮箱")).toBeInTheDocument();
    expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
    expect(screen.getByText("邮箱登录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送验证码" })).toBeEnabled();
  });

  it("moves on to the code once one was sent", async () => {
    mockUseLoginFlow.mockReturnValueOnce(flowWith({ step: "otp", email: "a@example.com" }));
    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage emailAuthEnabled />);

    expect(screen.getByText("验证验证码")).toBeInTheDocument();
    expect(screen.getByText("输入发送至 a@example.com 的 6 位验证码")).toBeInTheDocument();
    expect(screen.queryByLabelText("邮箱")).not.toBeInTheDocument();
  });

  it("says email sign-in is unavailable instead of offering a form that cannot send", async () => {
    mockUseLoginFlow.mockReturnValueOnce(flowWith({ error: "发生意外错误" }));
    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage />);

    expect(screen.getByText("邮箱登录未配置，请联系管理员")).toBeInTheDocument();
    expect(screen.queryByLabelText("邮箱")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("发生意外错误");
  });

  it("puts passkey sign-in first, above the email code, where the browser supports it", async () => {
    const handlePasskeyLogin = vi.fn();
    mockUseLoginFlow.mockReturnValueOnce(flowWith({ passkeySupported: true, handlePasskeyLogin }));

    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage emailAuthEnabled />);

    const passkey = screen.getByRole("button", { name: "使用通行密钥登录" });
    const send = screen.getByRole("button", { name: "发送验证码" });
    expect(passkey.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("或")).toBeInTheDocument();
    fireEvent.click(passkey);
    expect(handlePasskeyLogin).toHaveBeenCalledOnce();
  });

  it("drops the divider when a passkey is the only way in", async () => {
    mockUseLoginFlow.mockReturnValueOnce(flowWith({ passkeySupported: true }));
    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage />);

    expect(screen.getByRole("button", { name: "使用通行密钥登录" })).toBeInTheDocument();
    expect(screen.queryByText("或")).not.toBeInTheDocument();
  });

  it("hides passkey sign-in where the browser has no WebAuthn", async () => {
    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage emailAuthEnabled />);

    expect(screen.queryByRole("button", { name: "使用通行密钥登录" })).not.toBeInTheDocument();
  });

  it("offers exactly one development entry, and only when enabled", async () => {
    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    const { unmount } = render(<AuthLoginPage />);
    expect(screen.queryByRole("button", { name: /身份进入/ })).not.toBeInTheDocument();
    unmount();

    const handleDevSignIn = vi.fn();
    mockUseLoginFlow.mockReturnValueOnce(flowWith({ isDevAuthAvailable: true, handleDevSignIn }));
    render(<AuthLoginPage devAuthAvailable />);

    const entries = screen.getAllByRole("button", { name: /身份进入/ });
    expect(entries).toHaveLength(1);
    fireEvent.click(entries[0]!);
    expect(handleDevSignIn).toHaveBeenCalledWith();
    expect(mockUseLoginFlow).toHaveBeenLastCalledWith({ isDevAuthAvailable: true });
  });

  it("presents Cashier as a quiet app entry instead of a marketing page", async () => {
    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage />);

    const logo = document.querySelector('img[src*="icon.png"]');
    expect(logo).toHaveAttribute("alt", "");
    expect(screen.getByRole("heading", { name: "Cashier" })).toBeInTheDocument();
    expect(screen.getByText("一个安静的个人账本")).toBeInTheDocument();
  });

  it("tells an instance with no account which commands create one", async () => {
    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    const { unmount } = render(<AuthLoginPage emailAuthEnabled accountMissing />);

    expect(screen.getByRole("status")).toHaveTextContent("还没有账户");
    expect(screen.getByText(/npm run account:create -- --email/)).toHaveTextContent(
      /npm run account:enroll -- --email/
    );
    unmount();

    render(<AuthLoginPage emailAuthEnabled />);
    expect(screen.queryByText("还没有账户")).not.toBeInTheDocument();
  });

  it.each([
    ["reauth_required", "请重新登录以继续此操作。"],
    ["credentials_changed", "登录凭据已更新，请重新登录。"],
  ])("renders the %s login notice as status", async (notice, message) => {
    searchState.query = `notice=${notice}&callbackUrl=%2Fsettings`;
    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage />);

    expect(screen.getByRole("status")).toHaveTextContent(message);
    searchState.query = "";
  });
});
