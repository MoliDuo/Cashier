import type { ReactNode } from "react";
import { textRoleClassName } from "@/components/typography";
import { cn } from "@/lib/utils";

interface StatsPanelProps {
  title: string;
  /** Controls that act on this panel — a view switch, a show-all toggle. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * One block of the statistics tab. Every figure on the tab sits in one of
 * these, at one heading level, so a tab that now holds five of them reads as a
 * list of answers rather than a pile of widgets.
 */
export function StatsPanel({ title, actions, className, children }: StatsPanelProps) {
  return (
    <section className={cn("space-y-4 rounded-lg border border-border bg-surface p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={textRoleClassName("sectionTitle")}>{title}</h3>
        {actions != null && <div className="min-w-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
