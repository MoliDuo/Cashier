import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  sendOTPActionMock,
  otpSignInMock,
  devSignInMock,
  startPasskeyMock,
  finishPasskeyMock,
  startAuthenticationMock,
  pushMock,
  refreshMock,
  searchParams,
  trackMock,
} = vi.hoisted(() => ({
  sendOTPActionMock: vi.fn(),
  otpSignInMock: vi.fn(),
  devSignInMock: vi.fn(),
  startPasskeyMock: vi.fn(),
  finishPasskeyMock: vi.fn(),
  startAuthenticationMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  searchParams: { value: "" },
  trackMock: vi.fn(),
}));

vi.mock("@/lib/telemetry/client", () => ({ track: trackMock }));

vi.mock("@/modules/auth/server-actions/sign-in", () => ({
  signInWithOtpAction: otpSignInMock,
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

vi.mock("@/modules/auth/server-actions/send-otp", () => ({
  sendOTPAction: sendOTPActionMock,
}));

import { authCopy } from "@/copy/auth";
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
    expect(result.current.error).toBe(authCopy.rateLimitedWait({ minutes: 1 }));
    expect(result.current.isLoading).toBe(false);
  });

  it("says how long the wait is when the limit reports it", async () => {
    sendOTPActionMock.mockResolvedValue({ ok: false, code: "rate_limited", retryAfter: 3000 });
    const { result } = renderHook(() => useLoginFlow());

    act(() => result.current.setEmail("user@example.com"));
    await act(() => result.current.handleSendOTP(createEmailSubmitEvent("user@example.com")));

    expect(result.current.error).toBe(authCopy.rateLimitedWait({ minutes: 50 }));
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

    expect(result.current.step).toBe("otp");
    expect(result.current.expiresAt).toBe(1_800_000_000);
    expect(result.current.canResendAt).toBe(1_799_999_760);
    expect(result.current.error).toBeNull();
  });

  it("starts on the email step, with a code as the way in", () => {
    const { result } = renderHook(() => useLoginFlow());

    expect(result.current.step).toBe("email");
    expect(result.current).not.toHaveProperty("mode");
    expect(result.current).not.toHaveProperty("password");
  });

  it("goes back to the email step and drops the typed code", async () => {
    sendOTPActionMock.mockResolvedValue({
      ok: true,
      expiresIn: 300,
      expiresAt: 1_800_000_000,
      canResendAt: 1_799_999_760,
    });
    const { result } = renderHook(() => useLoginFlow());
    await act(() => result.current.handleSendOTP(createEmailSubmitEvent("user@example.com")));
    act(() => result.current.setOtp("123456"));

    act(() => result.current.handleChangeEmail());

    expect(result.current.step).toBe("email");
    expect(result.current.otp).toBe("");
    expect(result.current.email).toBe("user@example.com");
  });

  it("returns a same-site callbackUrl and refuses anything else", () => {
    searchParams.value = "callbackUrl=%2Fstats";
    expect(renderHook(() => useLoginFlow()).result.current.callbackUrl).toBe("/stats");

    searchParams.value = "callbackUrl=%2F%2Fevil.example";
    expect(renderHook(() => useLoginFlow()).result.current.callbackUrl).toBe("/");
  });

  it("submits a browser-filled email even when React state is empty", async () => {
    sendOTPActionMock.mockResolvedValue({ ok: false, code: "email_send_failed" });
    const { result } = renderHook(() => useLoginFlow());

    await act(() => result.current.handleSendOTP(createEmailSubmitEvent("autofill@example.com")));

    expect(sendOTPActionMock).toHaveBeenCalledWith("autofill@example.com");
    expect(result.current.email).toBe("autofill@example.com");
    expect(result.current.error).toBe(authCopy.emailSendFailed);
  });

  async function reachCodeStep() {
    sendOTPActionMock.mockResolvedValue({
      ok: true,
      expiresIn: 300,
      expiresAt: 1_800_000_000,
      canResendAt: 1_799_999_760,
    });
    const hook = renderHook(() => useLoginFlow());
    await act(() => hook.result.current.handleSendOTP(createEmailSubmitEvent("smoke@example.com")));
    return hook;
  }

  it("refuses a code that is not six digits without asking the server", async () => {
    const { result } = await reachCodeStep();
    act(() => result.current.setOtp("12a"));

    await act(() => result.current.handleVerifyOTP());

    expect(otpSignInMock).not.toHaveBeenCalled();
    expect(result.current.error).toBe(authCopy.invalidCode);
  });

  it("shows the failure and stays on the page for a rejected code", async () => {
    otpSignInMock.mockResolvedValue({ ok: false, code: "otp_invalid" });
    const { result } = await reachCodeStep();
    act(() => result.current.setOtp("000000"));

    await act(() => result.current.handleVerifyOTP());

    expect(otpSignInMock).toHaveBeenCalledWith("smoke@example.com", "000000");
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(result.current.error).toBe(authCopy.verifyFailed);
    expect(result.current.step).toBe("otp");
    expect(result.current.isLoading).toBe(false);
  });

  it("marks the code expired when the server says so", async () => {
    otpSignInMock.mockResolvedValue({ ok: false, code: "otp_expired" });
    const { result } = await reachCodeStep();
    act(() => result.current.setOtp("123456"));

    await act(() => result.current.handleVerifyOTP());

    expect(result.current.otpExpired).toBe(true);
    expect(result.current.error).toBe(authCopy.codeExpiredMessage);
  });

  it("lands on the callback page once the code is accepted", async () => {
    searchParams.value = "callbackUrl=%2Fsettings";
    otpSignInMock.mockResolvedValue({ ok: true });
    const { result } = await reachCodeStep();
    act(() => result.current.setOtp("123456"));

    await act(() => result.current.handleVerifyOTP());

    expect(pushMock).toHaveBeenCalledWith("/settings");
    expect(refreshMock).toHaveBeenCalledOnce();
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

  it("shows a passkey message, not a generic one, for an unknown passkey", async () => {
    startAuthenticationMock.mockResolvedValue(assertion);
    finishPasskeyMock.mockResolvedValue({ ok: false, code: "invalid_credentials" });
    const { result } = renderHook(() => useLoginFlow());

    await act(async () => {
      await result.current.handlePasskeyLogin();
    });

    expect(result.current.error).toBe(authCopy.passkeyFailed);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows the rate-limit message when starts are throttled", async () => {
    startPasskeyMock.mockResolvedValue({ ok: false, code: "passkey_rate_limited" });
    const { result } = renderHook(() => useLoginFlow());

    await act(async () => {
      await result.current.handlePasskeyLogin();
    });

    expect(result.current.error).toBe(authCopy.rateLimitedDesc);
    expect(startAuthenticationMock).not.toHaveBeenCalled();
  });
});

describe("useLoginFlow telemetry", () => {
  const options = { challenge: "c", rpId: "localhost" };

  beforeEach(() => {
    vi.clearAllMocks();
    searchParams.value = "";
  });

  const events = (name: string) =>
    trackMock.mock.calls.filter(([event]) => event === name).map(([, props]) => props);

  it("records a requested code and a refused one, without the email address", async () => {
    sendOTPActionMock.mockResolvedValueOnce({
      ok: true,
      expiresIn: 300,
      expiresAt: 1_800_000_000,
      canResendAt: 1_799_999_760,
    });
    const { result } = renderHook(() => useLoginFlow());
    await act(() => result.current.handleSendOTP(createEmailSubmitEvent("private@example.com")));

    sendOTPActionMock.mockResolvedValueOnce({ ok: false, code: "rate_limited" });
    await act(() => result.current.handleResendOTP());

    expect(events("signin.code")).toEqual([
      { resend: false, ok: true },
      { resend: true, ok: false, errorKind: "rate_limited" },
    ]);
    expect(JSON.stringify(trackMock.mock.calls)).not.toContain("private@example.com");
  });

  it("records a code sign-in by outcome, never the code", async () => {
    sendOTPActionMock.mockResolvedValue({
      ok: true,
      expiresIn: 300,
      expiresAt: 1_800_000_000,
      canResendAt: 1_799_999_760,
    });
    const { result } = renderHook(() => useLoginFlow());
    await act(() => result.current.handleSendOTP(createEmailSubmitEvent("user@example.com")));
    act(() => result.current.setOtp("123456"));

    otpSignInMock.mockResolvedValueOnce({ ok: false, code: "otp_invalid" });
    await act(() => result.current.handleVerifyOTP());
    otpSignInMock.mockResolvedValueOnce({ ok: true });
    await act(() => result.current.handleVerifyOTP());

    expect(events("signin.attempt")).toEqual([
      { method: "otp", ok: false, errorKind: "otp_invalid" },
      { method: "otp", ok: true },
    ]);
    expect(JSON.stringify(trackMock.mock.calls)).not.toContain("123456");
  });

  it("records passkey outcomes: success, an unknown passkey, a failed ceremony, but not a dismissal", async () => {
    startPasskeyMock.mockResolvedValue({ ok: true, challengeId: "id", options });
    // A finished sign-in leaves the hook loading, so each attempt gets a fresh one.
    const attempt = async () => {
      const { result } = renderHook(() => useLoginFlow());
      await act(() => result.current.handlePasskeyLogin());
    };

    startAuthenticationMock.mockResolvedValueOnce({ id: "cred" });
    finishPasskeyMock.mockResolvedValueOnce({ ok: true });
    await attempt();

    startAuthenticationMock.mockResolvedValueOnce({ id: "cred" });
    finishPasskeyMock.mockResolvedValueOnce({ ok: false, code: "invalid_credentials" });
    await attempt();

    startAuthenticationMock.mockRejectedValueOnce(new Error("hardware fault"));
    await attempt();

    startAuthenticationMock.mockRejectedValueOnce(
      Object.assign(new Error("cancelled"), { name: "NotAllowedError" })
    );
    await attempt();

    expect(events("signin.attempt")).toEqual([
      { method: "passkey", ok: true },
      { method: "passkey", ok: false, errorKind: "invalid_credentials" },
      { method: "passkey", ok: false, errorKind: "ceremony_failed" },
    ]);
  });

  it("records the development sign-in", async () => {
    devSignInMock.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useLoginFlow({ isDevAuthAvailable: true }));

    await act(() => result.current.handleDevSignIn());

    expect(events("signin.attempt")).toEqual([{ method: "dev", ok: true }]);
  });
});
