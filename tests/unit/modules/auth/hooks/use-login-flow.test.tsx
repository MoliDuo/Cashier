import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  sendOTPActionMock,
  passwordSignInMock,
  devSignInMock,
  startPasskeyMock,
  finishPasskeyMock,
  startAuthenticationMock,
  pushMock,
  refreshMock,
  searchParams,
} = vi.hoisted(() => ({
  sendOTPActionMock: vi.fn(),
  passwordSignInMock: vi.fn(),
  devSignInMock: vi.fn(),
  startPasskeyMock: vi.fn(),
  finishPasskeyMock: vi.fn(),
  startAuthenticationMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  searchParams: { value: "" },
}));

vi.mock("@/modules/auth/server-actions/sign-in", () => ({
  signInWithPasswordAction: passwordSignInMock,
  signInWithOtpAction: vi.fn(),
  devSignInAction: devSignInMock,
  startPasskeySignInAction: startPasskeyMock,
  finishPasskeySignInAction: finishPasskeyMock,
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => true,
  startAuthentication: startAuthenticationMock,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchParams.value),
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "zh",
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/modules/auth/server-actions/send-otp", () => ({
  sendOTPAction: sendOTPActionMock,
}));

import { useLoginFlow } from "@/modules/auth/hooks/use-login-flow";

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
    const { result } = renderHook(() => useLoginFlow());

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
    const { result } = renderHook(() => useLoginFlow());

    act(() => result.current.setEmail("user@example.com"));
    await act(() => result.current.handleSendOTP(createEmailSubmitEvent("user@example.com")));

    expect(result.current.mode).toBe("otp");
    expect(result.current.step).toBe("otp");
    expect(result.current.expiresAt).toBe(1_800_000_000);
    expect(result.current.canResendAt).toBe(1_799_999_760);
    expect(result.current.error).toBeNull();
  });

  it("starts in the requested login mode", () => {
    const { result } = renderHook(() => useLoginFlow({ initialMode: "otp" }));

    expect(result.current.mode).toBe("otp");
  });

  it("switches tabs and clears whatever the other tab was holding", async () => {
    sendOTPActionMock.mockResolvedValue({
      ok: true,
      expiresIn: 300,
      expiresAt: 1_800_000_000,
      canResendAt: 1_799_999_760,
    });
    const { result } = renderHook(() => useLoginFlow({ initialMode: "otp" }));
    await act(() => result.current.handleSendOTP(createEmailSubmitEvent("user@example.com")));
    act(() => result.current.setOtp("123456"));

    act(() => result.current.setMode("password"));

    expect(result.current.mode).toBe("password");
    expect(result.current.step).toBe("email");
    expect(result.current.otp).toBe("");
  });

  it("returns a same-site callbackUrl and refuses anything else", () => {
    searchParams.value = "callbackUrl=%2Fstats";
    expect(renderHook(() => useLoginFlow()).result.current.callbackUrl).toBe("/stats");

    searchParams.value = "callbackUrl=%2F%2Fevil.example";
    expect(renderHook(() => useLoginFlow()).result.current.callbackUrl).toBe("/");
  });

  it("submits browser-filled password fields even when React state is empty", async () => {
    passwordSignInMock.mockResolvedValue({ ok: false, code: "invalid_credentials" });
    const { result } = renderHook(() => useLoginFlow());

    await act(() =>
      result.current.handlePasswordLogin(
        createPasswordSubmitEvent("autofill@example.com", "autofilled-password")
      )
    );

    expect(passwordSignInMock).toHaveBeenCalledWith("autofill@example.com", "autofilled-password");
    expect(result.current.email).toBe("autofill@example.com");
    expect(result.current.password).toBe("");
  });

  it("shows the failure and stays on the page for a rejected login", async () => {
    passwordSignInMock.mockResolvedValue({ ok: false, code: "invalid_credentials" });
    const { result } = renderHook(() => useLoginFlow());
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
    devSignInMock.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useLoginFlow({ isDevAuthAvailable: true }));

    await act(() => result.current.handleDevSignIn());

    expect(devSignInMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/");
  });

  it("ignores the development sign-in when the entry is unavailable", async () => {
    const { result } = renderHook(() => useLoginFlow());

    await act(() => result.current.handleDevSignIn());

    expect(devSignInMock).not.toHaveBeenCalled();
  });
});

describe("useLoginFlow passkey sign-in", () => {
  const options = { challenge: "c", rpId: "localhost" };
  const assertion = { id: "cred", rawId: "cred", type: "public-key" };

  beforeEach(() => {
    vi.clearAllMocks();
    searchParams.value = "";
    startPasskeyMock.mockResolvedValue({ ok: true, challengeId: "id", options });
  });

  it("reports browser support and signs in with the assertion the browser returns", async () => {
    startAuthenticationMock.mockResolvedValue(assertion);
    finishPasskeyMock.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useLoginFlow());
    expect(result.current.passkeySupported).toBe(true);

    await act(async () => {
      await result.current.handlePasskeyLogin();
    });

    expect(startAuthenticationMock).toHaveBeenCalledWith({ optionsJSON: options });
    expect(finishPasskeyMock).toHaveBeenCalledWith("id", assertion);
    expect(pushMock).toHaveBeenCalledWith("/");
  });

  it("says nothing when the person dismisses the browser prompt", async () => {
    startAuthenticationMock.mockRejectedValue(
      Object.assign(new Error("cancelled"), { name: "NotAllowedError" })
    );
    const { result } = renderHook(() => useLoginFlow());

    await act(async () => {
      await result.current.handlePasskeyLogin();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(finishPasskeyMock).not.toHaveBeenCalled();
  });

  it("shows a passkey message, not the email-and-password one, for an unknown passkey", async () => {
    startAuthenticationMock.mockResolvedValue(assertion);
    finishPasskeyMock.mockResolvedValue({ ok: false, code: "invalid_credentials" });
    const { result } = renderHook(() => useLoginFlow());

    await act(async () => {
      await result.current.handlePasskeyLogin();
    });

    expect(result.current.error).toBe("passkeyFailed");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows the rate-limit message when starts are throttled", async () => {
    startPasskeyMock.mockResolvedValue({ ok: false, code: "passkey_rate_limited" });
    const { result } = renderHook(() => useLoginFlow());

    await act(async () => {
      await result.current.handlePasskeyLogin();
    });

    expect(result.current.error).toBe("rateLimitedDesc");
    expect(startAuthenticationMock).not.toHaveBeenCalled();
  });
});
