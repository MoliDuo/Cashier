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
  handleDevSignIn,
});

const mockUseLoginFlow = vi.hoisted(() =>
  vi.fn((_t, options?: { initialMode?: "password" | "otp"; isDevAuthAvailable?: boolean }) => ({
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

  it("renders the development sign-in action only when enabled", async () => {
    mockUseLoginFlow.mockReturnValue(createDevFlow(vi.fn()));

    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage devAuthAvailable />);

    expect(screen.getByRole("button", { name: "以开发身份进入" })).toBeInTheDocument();
  });

  it("adds the other couple member as a second development entry", async () => {
    const handleDevSignIn = vi.fn();
    mockUseLoginFlow.mockReturnValue(createDevFlow(handleDevSignIn));

    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage devAuthAvailable devPartnerLabel="Local Partner" />);

    expect(screen.getByRole("button", { name: "以开发身份进入" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "以 Local Partner 身份进入" }));

    expect(handleDevSignIn).toHaveBeenCalledWith("partner");
  });

  it("keeps a single development entry when no partner resolves", async () => {
    mockUseLoginFlow.mockReturnValue(createDevFlow(vi.fn()));

    const { AuthLoginPage } = await import("@/modules/auth/ui/login-page");
    render(<AuthLoginPage devAuthAvailable />);

    expect(screen.getAllByRole("button", { name: /身份进入/ })).toHaveLength(1);
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
