import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCameraCapture } from "@/modules/source-document/hooks/useCameraCapture";

function fakeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop };
}

function stubMediaDevices(options: {
  getUserMedia: (constraints: unknown) => Promise<MediaStream>;
  videoInputs?: number;
}) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: options.getUserMedia,
      enumerateDevices: vi
        .fn()
        .mockResolvedValue(
          Array.from({ length: options.videoInputs ?? 1 }, () => ({ kind: "videoinput" }))
        ),
    },
  });
}

function renderCamera(enabled: boolean) {
  return renderHook(
    ({ isEnabled }) => useCameraCapture({ enabled: isEnabled, onCapture: vi.fn() }),
    { initialProps: { isEnabled: enabled } }
  );
}

async function withSecureContext(value: boolean, run: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  Object.defineProperty(window, "isSecureContext", { configurable: true, value });
  try {
    await run();
  } finally {
    if (original != null) Object.defineProperty(window, "isSecureContext", original);
    else Reflect.deleteProperty(window, "isSecureContext");
  }
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("useCameraCapture", () => {
  it("leaves the camera alone until it is enabled", () => {
    const getUserMedia = vi.fn();
    stubMediaDevices({ getUserMedia });

    const { result } = renderCamera(false);

    expect(result.current.status).toBe("idle");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("reports a browser without a camera API instead of throwing", async () => {
    // jsdom itself is not a secure context, so ask for one to isolate the case.
    await withSecureContext(true, async () => {
      const { result } = renderCamera(true);

      await waitFor(() => expect(result.current.status).toBe("unsupported"));
    });
  });

  it("blames the address, not the browser, on a page outside a secure context", async () => {
    await withSecureContext(false, async () => {
      const { result } = renderCamera(true);

      await waitFor(() => expect(result.current.status).toBe("insecure"));
    });
  });

  it("reports a refusal instead of leaving a dead viewfinder", async () => {
    stubMediaDevices({
      getUserMedia: async () => {
        throw new Error("NotAllowedError");
      },
    });

    const { result } = renderCamera(true);

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
  });

  it("tries again after a refusal when asked", async () => {
    const { stream } = fakeStream();
    let attempts = 0;
    stubMediaDevices({
      getUserMedia: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("NotAllowedError");
        return stream;
      },
    });

    const { result } = renderCamera(true);
    await waitFor(() => expect(result.current.status).toBe("unavailable"));

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("opens the rear camera and switches to the front on request", async () => {
    const { stream, stop } = fakeStream();
    const constraints: unknown[] = [];
    stubMediaDevices({
      getUserMedia: async (next) => {
        constraints.push(next);
        return stream;
      },
      videoInputs: 2,
    });

    const { result } = renderCamera(true);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(constraints[0]).toMatchObject({ video: { facingMode: { ideal: "environment" } } });
    await waitFor(() => expect(result.current.canSwitch).toBe(true));
    expect(result.current.isMirrored).toBe(false);

    act(() => result.current.switchFacing());

    await waitFor(() => expect(constraints).toHaveLength(2));
    expect(constraints[1]).toMatchObject({ video: { facingMode: { ideal: "user" } } });
    expect(result.current.isMirrored).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("hides the switch on a device with one camera", async () => {
    stubMediaDevices({ getUserMedia: async () => fakeStream().stream, videoInputs: 1 });

    const { result } = renderCamera(true);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.canSwitch).toBe(false);
  });

  it("releases the camera when it stops being enabled", async () => {
    const { stream, stop } = fakeStream();
    stubMediaDevices({ getUserMedia: async () => stream });

    const { result, rerender } = renderCamera(true);
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ isEnabled: false });

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("releases the camera on unmount", async () => {
    const { stream, stop } = fakeStream();
    stubMediaDevices({ getUserMedia: async () => stream });

    const { result, unmount } = renderCamera(true);
    await waitFor(() => expect(result.current.status).toBe("ready"));

    unmount();

    expect(stop).toHaveBeenCalledTimes(1);
  });
});
