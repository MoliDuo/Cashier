import { beforeEach, describe, expect, it, vi } from "vitest";

const isPending = vi.fn<() => Promise<boolean>>();
const redirect = vi.fn<(url: string) => never>((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/modules/setup/server/initial-account", () => ({
  isSetupPending: () => isPending(),
}));

async function loadGate() {
  vi.resetModules();
  return import("@/modules/setup/server/setup-gate");
}

describe("redirectToSetupIfPending", () => {
  beforeEach(() => {
    isPending.mockReset();
    redirect.mockClear();
  });

  it("sends a first visitor to the wizard, and keeps asking while setup is pending", async () => {
    const { redirectToSetupIfPending } = await loadGate();
    isPending.mockResolvedValue(true);

    await expect(redirectToSetupIfPending()).rejects.toThrow("NEXT_REDIRECT:/setup");
    await expect(redirectToSetupIfPending()).rejects.toThrow("NEXT_REDIRECT:/setup");

    // A pending instance is still pending on the next request, so the answer
    // has to be re-read until it changes.
    expect(isPending).toHaveBeenCalledTimes(2);
  });

  it("stops querying once an account exists, because setup never un-runs", async () => {
    const { redirectToSetupIfPending } = await loadGate();
    isPending.mockResolvedValue(false);

    await redirectToSetupIfPending();
    await redirectToSetupIfPending();
    await redirectToSetupIfPending();

    expect(isPending).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
  });
});
