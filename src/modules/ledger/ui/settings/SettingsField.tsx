import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingsFieldProps {
  title: string;
  /** Buttons that act on this whole field, aligned with its heading. */
  actions?: ReactNode;
  stacked?: boolean;
  /**
   * Omitted when the heading and its actions are the whole field — 退出登录 has
   * nothing under its button — so no empty row is left behind.
   */
  children?: ReactNode;
}

export function SettingsField({ title, actions, stacked = false, children }: SettingsFieldProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        !stacked && "sm:flex-row sm:items-center sm:justify-between"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-text">{title}</h3>
        </div>
        {actions != null && <div className="shrink-0">{actions}</div>}
      </div>
      {children != null && <div className={cn(stacked ? "w-full" : "sm:max-w-md")}>{children}</div>}
    </div>
  );
}
