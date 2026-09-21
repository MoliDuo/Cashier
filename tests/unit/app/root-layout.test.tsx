import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMessages, getTranslations } = vi.hoisted(() => ({
  getMessages: vi.fn(),
  getTranslations: vi.fn(),
}));

vi.mock("next-intl/server", () => ({ getMessages, getTranslations }));

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();

  return {
    ...actual,
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

import RootLayout, { generateMetadata } from "@/app/layout";

describe("root layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMessages.mockResolvedValue({
      Common: { skipToContent: "跳到主要内容" },
      Metadata: { title: "标题", description: "描述" },
    });
    getTranslations.mockImplementation(async () => (key: string) => `t:${key}`);
  });

  it("renders the document in Chinese", async () => {
    const layout = await RootLayout({ children: <div>Child page</div> });

    expect(layout).toMatchObject({ type: "html", props: { lang: "zh" } });
  });

  it("reads its metadata from the Metadata namespace", async () => {
    const metadata = await generateMetadata();

    expect(getTranslations).toHaveBeenCalledWith("Metadata");
    expect(metadata).toMatchObject({ title: "t:title", description: "t:description" });
  });
});
