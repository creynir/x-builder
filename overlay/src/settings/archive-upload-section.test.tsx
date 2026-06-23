// @x-builder/overlay — ArchiveUploadSection tests (browser mode)
//
// The upload flow is: file selected → validateArchive(file) (loading) → if valid
// → importArchive(file) (progress). A validation rejection surfaces an inline
// Alert variant "danger" and makes NO importArchive call. Feedback is inline
// (no ToastRegion — out of scope).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { mountShadowHost, type ShadowHostHandle } from "../testing/shadow-host";
import { ArchiveUploadSection } from "./archive-upload-section";

let harness: ShadowHostHandle;

function mountSection(
  ui: Parameters<typeof ArchiveUploadSection>[0],
): HTMLElement {
  harness = mountShadowHost();
  render(<ArchiveUploadSection {...ui} />, { container: harness.mount });
  return harness.mount;
}

/** Drive a file selection through the section's file input. */
function selectFile(root: HTMLElement, file: File): void {
  const input = root.querySelector('input[type="file"]') as HTMLInputElement;
  if (!input) throw new Error("file input not found");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => {
  cleanup();
  harness?.cleanup();
});

const sampleFile = (): File =>
  new File(['{"tweets":[]}'], "tweets.js", { type: "application/javascript" });

describe("ArchiveUploadSection — rejection", () => {
  it("renders a danger Alert with the rejection message and makes NO importArchive call", async () => {
    const onUpload = vi.fn();
    const root = mountSection({
      onUpload,
      uploadState: { status: "rejected", message: "Archive contents are too large." },
    });

    const alert = root.querySelector('[role="alert"]') ?? root.firstElementChild!;
    expect(root.textContent).toContain("Archive contents are too large.");
    expect(
      alert.getAttribute("data-variant") ?? alert.getAttribute("class") ?? "",
    ).toContain("danger");

    // Nothing was triggered by simply rendering the rejected state.
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("does not show a danger Alert in the idle state", () => {
    const root = mountSection({ onUpload: vi.fn(), uploadState: "idle" });
    const alert = root.querySelector('[role="alert"]');
    const marker =
      alert?.getAttribute("data-variant") ?? alert?.getAttribute("class") ?? "";
    expect(marker).not.toContain("danger");
  });
});

describe("ArchiveUploadSection — file selection", () => {
  it("invokes onUpload with the selected file (parent runs validate→import)", () => {
    const onUpload = vi.fn();
    const root = mountSection({ onUpload, uploadState: "idle" });

    const file = sampleFile();
    selectFile(root, file);

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload).toHaveBeenCalledWith(file);
  });

  it("re-enables the input for retry after a rejection (file too large edge case)", () => {
    const root = mountSection({
      onUpload: vi.fn(),
      uploadState: { status: "rejected", message: "File too large." },
    });

    const input = root.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.disabled).toBe(false);
  });
});
