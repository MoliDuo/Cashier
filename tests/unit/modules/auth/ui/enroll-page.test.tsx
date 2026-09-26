import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const flow = vi.hoisted(() => ({
  linkValid: true,
  passkeySupported: true,
  pending: false,
  error: null as string | null,
  enroll: vi.fn(),
}));

vi.mock("@/modules/auth/hooks/use-enroll-flow", () => ({
  useEnrollFlow: () => flow,
}));

describe("EnrollPasskeyPage", () => {
  it("creates the passkey from a usable link", async () => {
    const { EnrollPasskeyPage } = await import("@/modules/auth/ui/enroll-page");
    render(<EnrollPasskeyPage token="t" />);

    fireEvent.click(screen.getByRole("button", { name: "创建通行密钥" }));
    expect(flow.enroll).toHaveBeenCalledOnce();
  });

  it("explains a spent, expired or unknown link and offers the way back", async () => {
    flow.linkValid = false;
    const { EnrollPasskeyPage } = await import("@/modules/auth/ui/enroll-page");
    render(<EnrollPasskeyPage token={null} />);

    expect(screen.getByRole("heading", { name: "链接不可用" })).toBeInTheDocument();
    expect(screen.getByText(/npm run account:enroll/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回登录" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: "创建通行密钥" })).not.toBeInTheDocument();
    flow.linkValid = true;
  });

  it("says so where the browser has no WebAuthn", async () => {
    flow.passkeySupported = false;
    const { EnrollPasskeyPage } = await import("@/modules/auth/ui/enroll-page");
    render(<EnrollPasskeyPage token="t" />);

    expect(screen.getByText(/当前浏览器不支持通行密钥/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "创建通行密钥" })).not.toBeInTheDocument();
    flow.passkeySupported = true;
  });
});
