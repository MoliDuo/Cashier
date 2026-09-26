import { createRef, type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import zh from "../../../../../messages/zh.json";
import { MAX_FILES } from "@/lib/storage/upload-policy";
import { SourceDocumentCameraPanel } from "@/modules/source-document/ui/SourceDocumentCameraPanel";

const messages = zh.SourceDocumentInput;

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
      {...handlers}
      {...overrides}
    />
  );

  return { ...handlers, view };
}

describe("SourceDocumentCameraPanel", () => {
  it("says why a browser with no camera API cannot take a photo", () => {
    const { view } = renderPanel({ status: "unsupported" });

    expect(screen.getByText(messages.cameraUnsupported)).toBeInTheDocument();
    expect(view.queryByRole("button", { name: messages.capturePhoto })).toBeNull();
  });

  it("blames the address when the page is not a secure context", () => {
    const { view } = renderPanel({ status: "insecure" });

    expect(screen.getByText(messages.cameraInsecure)).toBeInTheDocument();
    // Offering to reopen a camera that the browser will refuse would be a lie.
    expect(view.queryByRole("button", { name: messages.openCamera })).toBeNull();
  });

  it("asks before trying the camera again after a refusal", () => {
    const { onRetry } = renderPanel({ status: "unavailable" });

    expect(screen.getByText(messages.cameraUnavailable)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: zh.Common.retry }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("takes a photo from a running viewfinder", () => {
    const { onCapture } = renderPanel();
    const shutter = screen.getByRole("button", { name: messages.capturePhoto });

    expect(shutter).toBeEnabled();
    fireEvent.click(shutter);

    expect(onCapture).toHaveBeenCalledTimes(1);
  });

  it("holds the shutter back while the camera is still starting", () => {
    renderPanel({ status: "starting" });

    expect(screen.getByRole("button", { name: messages.capturePhoto })).toBeDisabled();
    expect(screen.getByText(messages.cameraStarting)).toBeInTheDocument();
  });

  it("holds the shutter back while the record is submitting", () => {
    renderPanel({ isBusy: true });

    expect(screen.getByRole("button", { name: messages.capturePhoto })).toBeDisabled();
  });

  it("stops offering the shutter once the images are full", () => {
    const { onCapture } = renderPanel({ remaining: 0 });
    const shutter = screen.getByRole("button", { name: messages.capturePhoto });

    expect(shutter).toBeDisabled();
    expect(shutter.parentElement).toHaveAttribute(
      "title",
      messages.tooManyImages.replace("{count}", String(MAX_FILES))
    );
    fireEvent.click(shutter);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("offers the front/back switch only when the device has more than one camera", () => {
    const single = renderPanel();
    expect(single.view.queryByRole("button", { name: messages.switchCamera })).toBeNull();

    const { onSwitchFacing } = renderPanel({ canSwitch: true });
    fireEvent.click(screen.getByRole("button", { name: messages.switchCamera }));

    expect(onSwitchFacing).toHaveBeenCalledTimes(1);
  });

  it("collapses to one button that brings the camera back", () => {
    const { onOpen, view } = renderPanel({ isOpen: false });

    expect(view.queryByRole("button", { name: messages.capturePhoto })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: messages.openCamera }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("collapses from the viewfinder itself", () => {
    const { onCollapse } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: messages.collapseCamera }));

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});
