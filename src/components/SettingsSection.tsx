import type { ReactNode } from "react";
import { textRoleClassName } from "@/components/typography";

interface SettingsSectionProps {
  title: string;
  /** One line under the title saying what the section is for. */
  description?: string;
  /**
   * The buttons that act on the whole section — 切换预设 / 管理分类 — so they sit
   * on the title row, where the section's own actions belong, instead of
   * trailing the fields they cover.
   */
  actions?: ReactNode;
  children: ReactNode;
}

export function SettingsSection({ title, description, actions, children }: SettingsSectionProps) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className={textRoleClassName("sectionTitle")}>{title}</h2>
          {description != null && (
            <p className={textRoleClassName("bodyMuted", "mt-1")}>{description}</p>
          )}
        </div>
        {actions != null && <div className="min-w-0">{actions}</div>}
      </div>
      <div className="[&>*+*]:mt-4 [&>*+*]:border-t [&>*+*]:border-border [&>*+*]:pt-4">
        {children}
      </div>
    </section>
  );
}
