import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendOTPActionMock, signInMock, pushMock, refreshMock, searchParams } = vi.hoisted(() => ({
  sendOTPActionMock: vi.fn(),
  signInMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  searchParams: { value: "" },
}));

vi.mock("next-auth/react", () => ({
  signIn: signInMock,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchParams.value),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
}));

vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/modules/auth/server-actions/send-otp", () => ({
  sendOTPAction: sendOTPActionMock,
}));

import { useLoginFlow } from "@/modules/auth/hooks/use-login-flow";

const t = (key: string) => key;
function createEmailSubmitEvent(email: string): React.FormEvent<HTMLFormElement> {
  const form = document.createElement("form");
  const emailInput = document.createElement("input");
  emailInput.name = "email";
  emailInput.value = email;
  form.append(emailInput);
  return {
    preventDefault: vi.fn(),
    currentTarget: form,
  } as unknown as React.FormEvent<HTMLFormElement>;
}

function createPasswordSubmitEvent(
  email: string,
  password: string
): React.FormEvent<HTMLFormElement> {
  const form = document.createElement("form");
  const emailInput = document.createElement("input");
  emailInput.name = "email";
  emailInput.value = email;
  const passwordInput = document.createElement("input");
  passwordInput.name = "password";
  passwordInput.value = password;
  form.append(emailInput, passwordInput);
  return {
    preventDefault: vi.fn(),
    currentTarget: form,
  } as unknown as React.FormEvent<HTMLFormElement>;
}

describe("useLoginFlow OTP sending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams.value = "";
  });

  it("shows the rate-limit message and stays on the email step", async () => {
    sendOTPActionMock.mockResolvedValue({
      ok: false,
      code: "rate_limited",
      retryAfter: 42,
    });
    const { result } = renderHook(() => useLoginFlow(t));

    act(() => result.current.setEmail("user@example.com"));
    await act(() => result.current.handleSendOTP(createEmailSubmitEvent("user@example.com")));

    expect(result.current.step).toBe("email");
    expect(result.current.error).toBe("rateLimitedDesc");
    expect(result.current.isLoading).toBe(false);
  });

  it("enters the OTP step only after a successful send", async () => {
    sendOTPActionMock.mockResolvedValue({
      ok: true,
      expiresIn: 300,
      expiresAt: 1_800_000_000,
      canResendAt: 1_799_999_760,
    });
    const { result } = renderHook(() => useLoginFlow(t));

    act(() => result.current.setEmail("user@example.com"));
    await act(() => result.current.handleSendOTP(createEmailSubmitEvent("user@example.com")));

    expect(result.current.mode).toBe("otp");
    expect(result.current.step).toBe("otp");
    expect(result.current.expiresAt).toBe(1_800_000_000);
    expect(result.current.canResendAt).toBe(1_799_999_760);
    expect(result.current.error).toBeNull();
  });

  it("starts in the requested login mode", () => {
    const { result } = renderHook(() => useLoginFlow(t, { initialMode: "otp" }));

    expect(result.current.mode).toBe("otp");
  });

  it("switches tabs and clears whatever the other tab was holding", async () => {
    sendOTPActionMock.mockResolvedValue({
      ok: true,
      expiresIn: 300,
      expiresAt: 1_800_000_000,
      canResendAt: 1_799_999_760,
    });
    const { result } = renderHook(() => useLoginFlow(t, { initialMode: "otp" }));
    await act(() => result.current.handleSendOTP(createEmailSubmitEvent("user@example.com")));
    act(() => result.current.setOtp("123456"));

    act(() => result.current.setMode("password"));

    expect(result.current.mode).toBe("password");
    expect(result.current.step).toBe("email");
    expect(result.current.otp).toBe("");
  });

  it("returns a same-site callbackUrl and refuses anything else", () => {
    searchParams.value = "callbackUrl=%2Fstats";
    expect(renderHook(() => useLoginFlow(t)).result.current.callbackUrl).toBe("/stats");

    searchParams.value = "callbackUrl=%2F%2Fevil.example";
    expect(renderHook(() => useLoginFlow(t)).result.current.callbackUrl).toBe("/");
  });

  it("submits browser-filled password fields even when React state is empty", async () => {
    signInMock.mockResolvedValue({ ok: false, error: "CredentialsSignin" });
    const { result } = renderHook(() => useLoginFlow(t));

    await act(() =>
      result.current.handlePasswordLogin(
        createPasswordSubmitEvent("autofill@example.com", "autofilled-password")
      )
    );

    expect(signInMock).toHaveBeenCalledWith("password", {
      email: "autofill@example.com",
      password: "autofilled-password",
      locale: "en",
      redirect: false,
      callbackUrl: "/",
    });
    expect(result.current.email).toBe("autofill@example.com");
    expect(result.current.password).toBe("");
  });

  it("treats an HTTP-success authentication error as a rejected login", async () => {
    signInMock.mockResolvedValue({
      ok: true,
      error: "CredentialsSignin",
      code: "invalid_credentials",
    });
    const { result } = renderHook(() => useLoginFlow(t));
    await act(() =>
      result.current.handlePasswordLogin(
        createPasswordSubmitEvent("smoke@example.com", "Wrong-password9")
      )
    );
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(result.current.error).toBe("invalidCredentials");
    expect(result.current.email).toBe("smoke@example.com");
    expect(result.current.isLoading).toBe(false);
  });

  it("signs in as the single dev account", async () => {
    signInMock.mockResolvedValue({ ok: false, error: "CredentialsSignin" });
    const { result } = renderHook(() => useLoginFlow(t, { isDevAuthAvailable: true }));

    await act(() => result.current.handleDevSignIn());

    expect(signInMock).toHaveBeenCalledWith("dev", {
      locale: "en",
      redirect: false,
      callbackUrl: "/",
    });
  });

  it("ignores the development sign-in when the entry is unavailable", async () => {
    const { result } = renderHook(() => useLoginFlow(t));

    await act(() => result.current.handleDevSignIn());

    expect(signInMock).not.toHaveBeenCalled();
  });
});
