/**
 * Just enough browser for Excalidraw's data functions in Node (AI-1): no
 * rendering, no jsdom. Imported before anything that loads Excalidraw.
 *
 * Text is measured at 0.6em per character, a little wider than Excalidraw's
 * fonts, so labels get room; the editor re-measures them with real fonts
 * (connector/remeasure.ts).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const noop = () => {};

const CHAR_EM = 0.6;

function context2d() {
  let font = "20px sans-serif";
  return {
    get font() {
      return font;
    },
    set font(value: string) {
      font = value;
    },
    measureText(text: string) {
      const px = parseFloat(font) || 20;
      return {
        width: text.length * px * CHAR_EM,
        actualBoundingBoxAscent: px * 0.8,
        actualBoundingBoxDescent: px * 0.2,
      };
    },
    fillText: noop,
    save: noop,
    restore: noop,
    scale: noop,
    translate: noop,
    clearRect: noop,
    fillRect: noop,
  };
}

function element(tag: string) {
  if (tag === "canvas") {
    const ctx = context2d();
    return { getContext: () => ctx, style: {}, width: 0, height: 0 };
  }
  return {
    style: {},
    setAttribute: noop,
    appendChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    classList: { add: noop, remove: noop },
  };
}

g.window ??= g;
g.document ??= {
  createElement: element,
  createElementNS: (_ns: string, tag: string) => element(tag),
  documentElement: { style: {} },
  body: { appendChild: noop, style: {} },
  head: { appendChild: noop },
  addEventListener: noop,
  removeEventListener: noop,
  querySelector: () => null,
  fonts: {
    add: noop,
    check: () => true,
    load: () => Promise.resolve([]),
    ready: Promise.resolve(),
    forEach: noop,
    *[Symbol.iterator]() {},
  },
};
g.navigator ??= { userAgent: "node", platform: "node" };
g.location ??= new URL("https://uncle-draw.invalid/");
g.devicePixelRatio ??= 1;
g.matchMedia ??= () => ({
  matches: false,
  addEventListener: noop,
  removeEventListener: noop,
  addListener: noop,
  removeListener: noop,
});
g.addEventListener ??= noop;
g.removeEventListener ??= noop;
g.FontFace ??= class {
  status = "loaded";
  constructor(
    public family: string,
    public source: string,
    public descriptors: Record<string, string> = {},
  ) {}
  load() {
    return Promise.resolve(this);
  }
};
g.HTMLElement ??= class {};
g.Element ??= class {};
g.Node ??= class {};
g.requestAnimationFrame ??= (cb: () => void) => setTimeout(cb, 0);
g.cancelAnimationFrame ??= clearTimeout;

export {};
