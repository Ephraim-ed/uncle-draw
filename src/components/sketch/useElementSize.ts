import { useLayoutEffect, useState, type RefObject } from "react";

export interface Size {
  width: number;
  height: number;
}

/**
 * Watches an element's border-box size with ResizeObserver, rounded to whole
 * pixels so sub-pixel layout jitter never triggers a redraw (§5.2).
 */
export function useElementSize(ref: RefObject<Element | null>, enabled = true): Size | null {
  const [size, setSize] = useState<Size | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const update = (width: number, height: number) => {
      const w = Math.round(width);
      const h = Math.round(height);
      setSize((prev) => (prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };

    const rect = el.getBoundingClientRect();
    update(rect.width, rect.height);

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const box = entry.borderBoxSize?.[0];
      if (box) update(box.inlineSize, box.blockSize);
      else update(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, enabled]);

  return size;
}
