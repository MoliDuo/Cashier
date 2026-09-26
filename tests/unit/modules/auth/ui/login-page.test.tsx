import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

const searchState = vi.hoisted(() => ({ query: "" }));

const createDevFlow = (handleDevSignIn: Mock) => ({
  callbackUrl: "/",
  mode: "password" as const,
  step: "email" as const,
  email: "",
  password: "",
  otp: "",
  isLoading: false,
  error: null,
  expiresAt: null,
  canResendAt: null,
  isDevAuthAvailable: true,
  passkeySupported: false,
  setEmail: vi.fn(),
  setPassword: vi.fn(),
  setOtp: vi.fn(),
  setMode: vi.fn(),
  handlePasswordLogin: vi.fn(),
  handleSendOTP: vi.fn(),
  handleVerifyOTP: vi.fn(),
  handleResendOTP: vi.fn(),
  handleChangeEmail: vi.fn(),
  handleOTPExpired: vi.fn(),
  handlePasskeyLogin: vi.fn(),
  handleDevSignIn,
});

const mockUseLoginFlow = vi.hoisted(() =>
  vi.fn((options?: { initialMode?: "password" | "otp"; isDevAuthAvailable?: boolean }) => ({
    passkeySupported: false,
    handlePasskeyLogin: vi.fn(),
    callbackUrl: "/",
    mode: options?.initialMode ?? "password",
    step: "email",
    email: "",
    password: "",
    otp: "",
    isLoading: false,
    error: null,
    expiresAt: null,
    canResendAt: null,
    isDevAuthAvailable: options?.isDevAuthAvailable ?? false,
    setEmail: vi.fn(),
    setPassword: vi.fn(),
    setOtp: vi.fn(),
    setMode: vi.fn(),
    handlePasswordLogin: vi.fn(),
    handleSendOTP: vi.fn(),
    handleVerifyOTP: vi.fn(),
    handleResendOTP: vi.fn(),
    handleChangeEmail: vi.fn(),
    handleOTPExpired: vi.fn(),
    handleDevSignIn: vi.fn(),
  }))
);

vi.mock("@/modules/auth/hooks/use-login-flow", () => ({
  useLoginFlow: mockUseLoginFlow,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchState.query),
}));

describe("AuthLoginPage", () => {
  it("renders password login by default", async () => {
    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage />);

    expect(screen.getByLabelText("邮箱")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "邮箱验证码" })).not.toBeInTheDocument();
    expect(screen.getByText("密码登录")).toBeInTheDocument();
  });

  it("offers OTP as an optional mode only when email delivery is enabled", async () => {
    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage emailAuthEnabled />);

    expect(screen.getByRole("button", { name: "密码" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "邮箱验证码" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("邮箱登录")).toBeInTheDocument();
  });

  it("puts passkey sign-in first, above the other ways in, where the browser supports it", async () => {
    const handlePasskeyLogin = vi.fn();
    mockUseLoginFlow.mockReturnValueOnce({
      ...createDevFlow(vi.fn()),
      isDevAuthAvailable: false,
      passkeySupported: true,
      handlePasskeyLogin,
    });

    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage />);

    const passkey = screen.getByRole("button", { name: "使用通行密钥登录" });
    const submit = screen.getByRole("button", { name: "登录" });
    expect(passkey.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(passkey);
    expect(handlePasskeyLogin).toHaveBeenCalledOnce();
  });

  it("hides passkey sign-in where the browser has no WebAuthn", async () => {
    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage />);

    expect(screen.queryByRole("button", { name: "使用通行密钥登录" })).not.toBeInTheDocument();
  });

  it("renders the development sign-in action only when enabled", async () => {
    mockUseLoginFlow.mockReturnValue(createDevFlow(vi.fn()));

    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage devAuthAvailable />);

    expect(screen.getByRole("button", { name: "以开发身份进入" })).toBeInTheDocument();
  });

  it("offers exactly one development entry, because there is one account", async () => {
    const handleDevSignIn = vi.fn();
    mockUseLoginFlow.mockReturnValue(createDevFlow(handleDevSignIn));

    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage devAuthAvailable />);

    const entries = screen.getAllByRole("button", { name: /身份进入/ });
    expect(entries).toHaveLength(1);
    fireEvent.click(entries[0]!);

    expect(handleDevSignIn).toHaveBeenCalledWith();
  });

  it("presents Cashier as a quiet app entry instead of a marketing page", async () => {
    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage />);

    const logo = document.querySelector('img[src*="icon.png"]');
    expect(logo).toHaveAttribute("alt", "");
    expect(screen.getByRole("heading", { name: "Cashier" })).toBeInTheDocument();
    expect(screen.getByText("一个安静的个人账本")).toBeInTheDocument();
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
