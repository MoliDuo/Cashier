import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const devSignIn = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/modules/auth/server-actions/sign-in", () => ({ devSignInAction: devSignIn }));

import { AuthLoginPage } from "@/modules/auth/ui/login-page";

describe("AuthLoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("presents Cashier as a quiet app entry with one way in, a link to the provider sign-in", () => {
    render(<AuthLoginPage callbackUrl="/settings" />);

    expect(document.querySelector('img[src*="icon.png"]')).toHaveAttribute("alt", "");
    expect(screen.getByRole("heading", { name: "Cashier" })).toBeInTheDocument();
    expect(screen.getByText("一个安静的个人账本")).toBeInTheDocument();
    // A plain link, so the browser follows the redirect to the provider itself.
    expect(screen.getByRole("link", { name: "登录" })).toHaveAttribute(
      "href",
      "/api/auth/login?callbackUrl=%2Fsettings"
    );
    expect(screen.queryByLabelText("邮箱")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
  });

  it.each([
    ["signed_out", "status", "已退出登录"],
    ["credentials_changed", "status", "登录邮箱已变更"],
    ["not_bound", "alert", "这个账号还没有绑定"],
    ["denied", "alert", "登录已取消"],
    ["failed", "alert", "登录没有完成"],
  ] as const)("explains %s and offers to sign in again", (messageKey, role, title) => {
    render(<AuthLoginPage messageKey={messageKey} />);

    expect(screen.getByRole(role)).toHaveTextContent(title);
    expect(screen.getByRole("link", { name: "重新登录" })).toBeInTheDocument();
  });

  it("tells an instance with no account which command creates one, and offers no sign-in yet", () => {
    const { unmount } = render(<AuthLoginPage accountMissing />);

    expect(screen.getByRole("status")).toHaveTextContent("还没有账户");
    expect(screen.getByText(/npm run account:create -- --email/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "登录" })).not.toBeInTheDocument();
    unmount();

    render(<AuthLoginPage />);
    expect(screen.queryByText("还没有账户")).not.toBeInTheDocument();
  });

  it("offers exactly one development entry, and only when enabled", () => {
    const { unmount } = render(<AuthLoginPage />);
    expect(screen.queryByRole("button", { name: /身份进入/ })).not.toBeInTheDocument();
    unmount();

    render(<AuthLoginPage devAuthAvailable />);
    expect(screen.getAllByRole("button", { name: /身份进入/ })).toHaveLength(1);
  });

  it("enters as the dev account and goes where the visitor was headed", async () => {
    devSignIn.mockResolvedValue({ ok: true });
    render(<AuthLoginPage devAuthAvailable callbackUrl="/stats" />);

    fireEvent.click(screen.getByRole("button", { name: /身份进入/ }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/stats"));
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("says so when the dev sign-in is refused", async () => {
    devSignIn.mockResolvedValue({ ok: false });
    render(<AuthLoginPage devAuthAvailable />);

    fireEvent.click(screen.getByRole("button", { name: /身份进入/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("开发会话启动失败");
    expect(router.push).not.toHaveBeenCalled();
  });
});
