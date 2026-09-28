import { useEffect, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { useHeaderSummary, type HeaderSummary } from "@/modules/workspace/store";

/** The controls the phone's top-bar summary drops down. */
export const LIST_CONTROLS_ID = "ledger-list-controls";

interface ListControlsDropProps extends ComponentProps<"div"> {
  /**
   * What the page is browsing, as the phone's top bar prints it, or null while
   * the controls belong on the page (selecting). With a summary a phone folds
   * the controls into the top bar and drops them down from there; from md up
   * they stay where they are.
   */
  summary: HeaderSummary | null;
}

/**
 * A page's period and filter controls, which a phone keeps behind the top
 * bar's summary. 账目 and 统计 each put up their own, so each keeps its own
 * period.
 */
export function ListControlsDrop({
  summary,
  className,
  children,
  ...props
}: ListControlsDropProps) {
  const { open, close } = useHeaderSummary(summary);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A period or filter dialog opened from the controls takes its own Escape.
      const inDialog = event.target instanceof Element && event.target.closest('[role="dialog"]');
      if (event.key === "Escape" && inDialog == null) close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  return (
    <>
      {open ? (
        // Below the top bar and above the page; the bars stay live, so the
        // summary that opened the controls also folds them.
        <div
          aria-hidden="true"
          className="fixed inset-0 z-10 bg-black/20 md:hidden"
          onClick={close}
        />
      ) : null}
      <div
        {...props}
        id={LIST_CONTROLS_ID}
        className={cn(
          className,
          summary != null &&
            (open
              ? "max-md:fixed max-md:inset-x-3 max-md:top-[calc(4rem+env(safe-area-inset-top))] max-md:z-20 max-md:shadow-lg"
              : "max-md:hidden")
        )}
      >
        {children}
      </div>
    </>
  );
}
