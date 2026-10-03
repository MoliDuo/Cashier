import { vi } from "vitest";
import React from "react";
import { installTestEnvironment } from "../scripts/test-environment";
import "./setup.network";

installTestEnvironment();

// Server code reads the session through getCurrentSession, which needs a
// request's cookies; tests stand in a signed-in session and override it per
// test with vi.mocked(getCurrentSession).
vi.mock("@/modules/auth/server/current-session", async () => {
  const { testSession } = await import("./helpers/session");
  return {
    getCurrentSession: vi.fn(async () => testSession()),
    startSession: vi.fn(async () => {}),
    endSession: vi.fn(async () => {}),
  };
});

vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: { src: string; alt: string; [key: string]: unknown }) => {
    return React.createElement("img", { ...props, src: props.src });
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));
