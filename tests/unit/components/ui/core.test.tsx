import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

vi.mock("next-intl", async () => {
  const msgs = (await import("messages/zh.json")).default as Record<string, Record<string, string>>;

  return {
    useTranslations: (namespace?: string) => {
      return (key: string, values?: Record<string, string | number>) => {
        const nsMessages = namespace ? msgs[namespace] : undefined;
        let msg = nsMessages?.[key];
        if (msg == null) {
          for (const ns in msgs) {
            if (msgs[ns]?.[key] != null) {
              msg = msgs[ns][key];
              break;
            }
          }
        }
        if (msg == null) return key;
        if (values != null) {
          Object.entries(values).forEach(([k, v]) => {
            msg = (msg as string).replace(`{${k}}`, String(v));
          });
        }
        return msg;
      };
    },
    useLocale: () => "zh",
    useMessages: () => msgs,
    useTimeZone: () => "UTC",
    useNow: () => new Date(),
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

describe("Dialog", () => {
  it("renders the close screen-reader text from the Common namespace", () => {
    render(
      <Dialog open>
        <DialogTrigger />
        <DialogContent variant="modal">
          <p>Dialog body</p>
        </DialogContent>
      </Dialog>
    );

    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });

  it("focuses the dialog title before its close control", async () => {
    render(
      <Dialog open>
        <DialogContent variant="modal">
          <DialogTitle>Dialog title</DialogTitle>
          <p>Dialog body</p>
        </DialogContent>
      </Dialog>
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Dialog title" })).toHaveFocus()
    );
    expect(screen.getByRole("button", { name: "关闭" })).not.toHaveFocus();
  });

  it("increments the layer for a nested task dialog", () => {
    render(
      <Dialog open>
        <DialogContent variant="detail">
          <p>Detail body</p>
          <Dialog open>
            <DialogContent variant="modal">
              <p>Task body</p>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>
    );

    const detail = screen.getByText("Detail body").parentElement;
    const task = screen.getByText("Task body").parentElement;
    expect(Number(task?.style.zIndex)).toBeGreaterThan(Number(detail?.style.zIndex));
  });
});
