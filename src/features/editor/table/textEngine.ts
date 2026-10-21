import { convertToExcalidrawElements, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import type { TextEngine } from "./grid";

/**
 * Text measuring with Excalidraw's own code: restoreElements() with
 * refreshDimensions wraps bound text to its container and measures it, the
 * same way it does for a loaded scene.
 */
export const excalidrawText: TextEngine = {
  create({ text, fontSize, fontFamily, strokeColor, containerId, groupIds, frameId, textAlign }) {
    const [el] = convertToExcalidrawElements([
      {
        type: "text",
        text,
        x: 0,
        y: 0,
        fontSize,
        fontFamily,
        strokeColor,
        textAlign,
        verticalAlign: "middle",
      },
    ]);
    return { ...(el as ExcalidrawTextElement), containerId, groupIds: [...groupIds], frameId, index: null };
  },

  rewrap(texts, containers) {
    // Excalidraw wraps `text`, which already holds the old line breaks; start
    // from what was typed so a wider column un-wraps too.
    const input = texts.map((t) => ({
      ...t,
      text: t.originalText,
      width: Math.max(1, t.width),
      height: Math.max(1, t.height),
    }));
    const out = restoreElements([...containers, ...input], null, {
      refreshDimensions: true,
      repairBindings: true,
    });
    const byId = new Map(out.map((el) => [el.id, el]));
    return texts.map((t) => {
      const m = byId.get(t.id);
      return m?.type === "text"
        ? { ...t, text: m.text, width: m.width, height: m.height, lineHeight: m.lineHeight }
        : t;
    });
  },
};
