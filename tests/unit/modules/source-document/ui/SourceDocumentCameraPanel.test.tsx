import { createRef, type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourceDocumentCameraPanel } from "@/modules/source-document/ui/SourceDocumentCameraPanel";

const messages: ComponentProps<typeof SourceDocumentCameraPanel>["messages"] = {
  preview: "Camera preview",
  starting: "Starting camera",
  unavailable: "Camera unavailable",
  unsupported: "This browser cannot take photos",
  insecure: "This address is not HTTPS",
  capture: "Take photo",
  limitReached: "You can upload up to 3 images.",
  switchCamera: "Switch camera",
  collapse: "Collapse camera",
  open: "Open camera",
  retry: "Retry",
};

function renderPanel(overrides: Partial<ComponentProps<typeof SourceDocumentCameraPanel>> = {}) {
  const handlers = {
    onCapture: vi.fn(),
    onSwitchFacing: vi.fn(),
    onOpen: vi.fn(),
    onCollapse: vi.fn(),
    onRetry: vi.fn(),
  };

  const view = render(
    <SourceDocumentCameraPanel
      videoRef={createRef<HTMLVideoElement>()}
      status="ready"
      canSwitch={false}
      isMirrored={false}
      isOpen
      isBusy={false}
      remaining={3}
      messages={messages}
      {...handlers}
      {...overrides}
    />
  );

  return { ...handlers, view };
}

describe("SourceDocumentCameraPanel", () => {
  it("says why a browser with no camera API cannot take a photo", () => {
    const { view } = renderPanel({ status: "unsupported" });

    expect(screen.getByText("This browser cannot take photos")).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Take photo" })).toBeNull();
  });

  it("blames the address when the page is not a secure context", () => {
    const { view } = renderPanel({ status: "insecure" });

    expect(screen.getByText("This address is not HTTPS")).toBeInTheDocument();
    // Offering to reopen a camera that the browser will refuse would be a lie.
    expect(view.queryByRole("button", { name: "Open camera" })).toBeNull();
  });

  it("asks before trying the camera again after a refusal", () => {
    const { onRetry } = renderPanel({ status: "unavailable" });

    expect(screen.getByText("Camera unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("takes a photo from a running viewfinder", () => {
    const { onCapture } = renderPanel();
    const shutter = screen.getByRole("button", { name: "Take photo" });

    expect(shutter).toBeEnabled();
    fireEvent.click(shutter);

    expect(onCapture).toHaveBeenCalledTimes(1);
  });

  it("holds the shutter back while the camera is still starting", () => {
    renderPanel({ status: "starting" });

    expect(screen.getByRole("button", { name: "Take photo" })).toBeDisabled();
    expect(screen.getByText("Starting camera")).toBeInTheDocument();
  });

  it("holds the shutter back while the record is submitting", () => {
    renderPanel({ isBusy: true });

    expect(screen.getByRole("button", { name: "Take photo" })).toBeDisabled();
  });

  it("stops offering the shutter once the images are full", () => {
    const { onCapture } = renderPanel({ remaining: 0 });
    const shutter = screen.getByRole("button", { name: "Take photo" });

    expect(shutter).toBeDisabled();
    fireEvent.click(shutter);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("offers the front/back switch only when the device has more than one camera", () => {
    const single = renderPanel();
    expect(single.view.queryByRole("button", { name: "Switch camera" })).toBeNull();

    const { onSwitchFacing } = renderPanel({ canSwitch: true });
    fireEvent.click(screen.getByRole("button", { name: "Switch camera" }));

    expect(onSwitchFacing).toHaveBeenCalledTimes(1);
  });

  it("collapses to one button that brings the camera back", () => {
    const { onOpen, view } = renderPanel({ isOpen: false });

    expect(view.queryByRole("button", { name: "Take photo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open camera" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("collapses from the viewfinder itself", () => {
    const { onCollapse } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Collapse camera" }));

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});
