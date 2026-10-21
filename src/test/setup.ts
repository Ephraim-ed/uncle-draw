import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import "vitest-canvas-mock";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// jsdom gaps used by the sketch kit.
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom has no FontFace; Excalidraw registers its fonts with it before measuring text.
if (typeof globalThis.FontFace === "undefined") {
  globalThis.FontFace = class {
    status = "loaded";
    constructor(
      public family: string,
      public source: string,
      public descriptors: Record<string, string> = {},
    ) {}
    load() {
      return Promise.resolve(this);
    }
  } as unknown as typeof FontFace;
}

// <dialog> showModal/close (jsdom implements the element but not modality).
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
