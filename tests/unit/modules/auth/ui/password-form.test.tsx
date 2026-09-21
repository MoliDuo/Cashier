import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import zhMessages from "../../../../../messages/zh.json";
import { PasswordForm } from "@/modules/auth/ui/PasswordForm";
import type {
  PasswordMutationActionErrorCode,
  PasswordMutationActionResult,
} from "@/modules/auth/contracts";

const { changePassword, setPassword } = vi.hoisted(() => ({
  changePassword: vi.fn(),
  setPassword: vi.fn(),
}));

vi.mock("@/modules/auth/server-actions/change-password", () => ({
  changePasswordAction: changePassword,
}));
vi.mock("@/modules/auth/server-actions/set-password", () => ({
  setPasswordAction: setPassword,
}));

describe("PasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locks the dialog and all mutually exclusive controls while saving", async () => {
    let resolveSave!: (result: PasswordMutationActionResult) => void;
    setPassword.mockReturnValueOnce(
      new Promise<PasswordMutationActionResult>((resolve) => {
        resolveSave = resolve;
      })
    );
    render(<PasswordForm hasPassword={false} passwordUpdatedAt={null} />);

    fireEvent.click(screen.getByRole("button", { name: "设置密码" }));
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: "correct-horse-battery" },
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: "correct-horse-battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存密码" }));

    const cancel = screen.getByRole("button", { name: "取消" });
    await waitFor(() => expect(cancel).toBeDisabled());
    expect(screen.getByLabelText("新密码")).toBeDisabled();
    for (const toggle of screen.getAllByLabelText("显示密码")) {
      expect(toggle).toBeDisabled();
    }
    fireEvent.click(cancel);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(setPassword).toHaveBeenCalledTimes(1);

    resolveSave({
      ok: true,
      passwordUpdatedAt: "2026-08-11T00:00:00.000Z",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it.each([
    ["password_too_short", "密码长度必须为 8–128 个字符。"],
    [
      "password_requirements_not_met",
      "密码必须至少包含一个字母和一个数字，且 UTF-8 编码不得超过 72 字节。",
    ],
    ["password_mismatch", "两次输入的密码不一致。"],
    ["current_password_wrong", "当前密码不正确。"],
    ["conflict", "密码已在其他位置被修改，请重新打开此窗口后再试。"],
    ["validation_failed", "无法保存密码"],
    ["unexpected", "无法保存密码"],
  ] satisfies [PasswordMutationActionErrorCode, string][])(
    "localizes the %s action error",
    async (code, expectedMessage) => {
      changePassword.mockResolvedValueOnce({ ok: false, code });
      render(<PasswordForm hasPassword passwordUpdatedAt={null} />);

      submitChangePassword();

      expect(await screen.findByRole("alert")).toHaveTextContent(expectedMessage);
    }
  );

  it("does not expose raw thrown error messages", async () => {
    setPassword.mockRejectedValueOnce(new Error("Current password rejected by upstream"));
    render(<PasswordForm hasPassword={false} passwordUpdatedAt={null} />);

    submitSetPassword();

    expect(await screen.findByRole("alert")).toHaveTextContent("无法保存密码");
    expect(screen.queryByText("Current password rejected by upstream")).toBeNull();
  });

  it("formats the last-updated date in Chinese", () => {
    const updatedAt = "2026-08-11T00:00:00.000Z";
    render(
      <NextIntlClientProvider locale="zh" messages={zhMessages}>
        <PasswordForm hasPassword passwordUpdatedAt={updatedAt} />
      </NextIntlClientProvider>
    );

    expect(screen.getByText("上次修改于 2026年8月11日 星期二")).toBeInTheDocument();
  });
});

function submitSetPassword() {
  fireEvent.click(screen.getByRole("button", { name: "设置密码" }));
  fireEvent.change(screen.getByLabelText("新密码"), {
    target: { value: "password1" },
  });
  fireEvent.change(screen.getByLabelText("确认新密码"), {
    target: { value: "password1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存密码" }));
}

function submitChangePassword() {
  fireEvent.click(screen.getByRole("button", { name: "修改密码" }));
  fireEvent.change(screen.getByLabelText("当前密码"), {
    target: { value: "old-password1" },
  });
  fireEvent.change(screen.getByLabelText("新密码"), {
    target: { value: "new-password1" },
  });
  fireEvent.change(screen.getByLabelText("确认新密码"), {
    target: { value: "new-password1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存密码" }));
}
