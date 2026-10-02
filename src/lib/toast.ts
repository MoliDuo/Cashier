import { toast as sonnerToast } from "sonner";
import { track } from "@/lib/telemetry/client";

type ToastArgs = Parameters<typeof sonnerToast.success>;
type Level = "success" | "error" | "warning";

function shown(level: Level, show: (...args: ToastArgs) => string | number) {
  return (...args: ToastArgs): string | number => {
    // The level only: a toast's text can name a file, a book or a merchant.
    track("$toast", { level });
    return show(...args);
  };
}

/**
 * The app's toast. It is sonner's, with each toast also recorded as a `$toast`
 * telemetry event that carries its level and nothing of its text.
 */
export const toast = {
  success: shown("success", (...args) => sonnerToast.success(...args)),
  error: shown("error", (...args) => sonnerToast.error(...args)),
  warning: shown("warning", (...args) => sonnerToast.warning(...args)),
};
