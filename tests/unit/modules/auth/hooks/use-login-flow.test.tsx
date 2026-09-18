import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendOTPActionMock, signInMock, pushMock, refreshMock, routerState } = vi.hoisted(() => ({
  sendOTPActionMock: vi.fn(),
  signInMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  routerState: { pathname: "/en/login", search: "" },
}));

vi.mock("next-auth/react", () => ({
  signIn: signInMock,
}));

// Mirrors Next's own App Router URL state: derived from a mutable
// `routerState` that only advances when history.pushState/replaceState is
// applied through the app-router's own logic (see the fake patch below), not
// through a plain, unrouted call.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(routerState.search),
  usePathname: () => routerState.pathname,
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

/**
 * Real Next.js (app-router.js) patches history.pushState/replaceState so
 * that calling them with a `data` argument that carries the router's own
 * `__NA` marker short-circuits to the native browser implementation and
 * skips updating the router's canonical URL — this is what makes
 * `window.history.state` (which always carries `__NA: true` on an App
 * Router page) unsafe to pass back into pushState/replaceState. This fake
 * reproduces that exact contract in jsdom so a regression (passing
 * `window.history.state` again) is caught by a stalled `routerState`.
 */
function installFakeNextHistoryPatch() {
  const originalPush = window.history.pushState.bind(window.history);
  const originalReplace = window.history.replaceState.bind(window.history);

  function applyUrl(url: string | URL) {
    const parsed = new URL(url, "http://localhost");
    routerState.pathname = parsed.pathname;
    routerState.search = parsed.search;
  }

  window.history.pushState = function fakePushState(
    data: unknown,
    unused: string,
    url?: string | URL | null
  ) {
    const carriesNA =
      typeof data === "object" && data !== null && (data as { __NA?: boolean }).__NA;
    if (carriesNA) {
      return originalPush(data, unused, url ?? undefined);
    }
    if (url != null) applyUrl(url);
    return originalPush(
      { ...(typeof data === "object" && data != null ? data : {}), __NA: true },
      unused,
      url ?? undefined
    );
  };

  window.history.replaceState = function fakeReplaceState(
    data: unknown,
    unused: string,
    url?: string | URL | null
  ) {
    const carriesNA =
      typeof data === "object" && data !== null && (data as { __NA?: boolean }).__NA;
    if (carriesNA) {
      return originalReplace(data, unused, url ?? undefined);
    }
    if (url != null) applyUrl(url);
    return originalReplace(
      { ...(typeof data === "object" && data != null ? data : {}), __NA: true },
      unused,
      url ?? undefined
    );
  };

  return () => {
    window.history.pushState = originalPush;
    window.history.replaceState = originalReplace;
  };
}

import { useLoginFlow } from "@/modules/auth/hooks/use-login-flow";
import { useLoginDraftStore } from "@/modules/auth/login-draft-store";

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
  let uninstallHistoryPatch: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    useLoginDraftStore.getState().reset();
    routerState.pathname = "/en/login";
    routerState.search = "";
    uninstallHistoryPatch = installFakeNextHistoryPatch();
    // Simulate Next's HistoryUpdater, which always stamps the current
    // history entry's state with __NA: true before user code ever runs.
    window.history.replaceState(null, "", "/en/login");
  });

  afterEach(() => {
    uninstallHistoryPatch();
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

  it("enters the OTP step even when sessionStorage writes are restricted", async () => {
    sendOTPActionMock.mockResolvedValue({
      ok: true,
      expiresIn: 300,
      expiresAt: 1_800_000_000,
      canResendAt: 1_799_999_760,
    });
    const originalSetItem = sessionStorage.setItem;
    sessionStorage.setItem = () => {
      throw new Error("quota exceeded");
    };
    try {
      const { result } = renderHook(() => useLoginFlow(t));

      act(() => result.current.setEmail("user@example.com"));
      await act(() => result.current.handleSendOTP(createEmailSubmitEvent("user@example.com")));

      expect(result.current.mode).toBe("otp");
      expect(result.current.step).toBe("otp");
      expect(result.current.error).toBeNull();
    } finally {
      sessionStorage.setItem = originalSetItem;
    }
  });

  it("starts in the requested login mode", () => {
    const { result } = renderHook(() => useLoginFlow(t, { initialMode: "otp" }));

    expect(result.current.mode).toBe("otp");
  });

  it("switches tabs by advancing the router's URL state, not just window.location", () => {
    // Regression test for a bug where writeFlowUrl passed
    // `window.history.state` (which always carries Next's `__NA` marker on
    // an App Router page) back into pushState, causing Next's own patch to
    // short-circuit and never update useSearchParams(). The tab looked
    // unclickable because `mode` never advanced past its initial value.
    const { result, rerender } = renderHook(() => useLoginFlow(t, { initialMode: "otp" }));
    expect(result.current.mode).toBe("otp");

    act(() => result.current.setMode("password"));
    // A real App Router page re-renders on its own once the router commits
    // the URL change (dispatched via startTransition); force that here so
    // the assertion reflects what routerState actually holds.
    rerender();

    expect(routerState.pathname).toBe("/en/login");
    expect(routerState.search).toBe("?authMode=password");
    expect(result.current.mode).toBe("password");
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
