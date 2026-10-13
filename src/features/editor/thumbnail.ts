import { exportToBlob, getNonDeletedElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import { THUMBNAIL_INTERVAL_MS, THUMBNAIL_MAX_SIDE } from "./constants";

export interface ThumbnailSnapshot {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

/**
 * Renders a dashboard preview (tech §7.5): WebP, 480 px max, always light
 * (VISUAL_DESIGN.md §3.3), background on. Returns null for an empty board.
 */
export async function renderThumbnail(snapshot: ThumbnailSnapshot): Promise<Blob | null> {
  const elements = getNonDeletedElements(snapshot.elements);
  if (elements.length === 0) return null;
  return exportToBlob({
    elements,
    appState: {
      viewBackgroundColor: snapshot.appState.viewBackgroundColor ?? "#ffffff",
      exportBackground: true,
      exportWithDarkMode: false,
    },
    files: snapshot.files,
    mimeType: "image/webp",
    quality: 0.85,
    maxWidthOrHeight: THUMBNAIL_MAX_SIDE,
  });
}

/**
 * Regenerates the thumbnail at most once a minute while the board is changing,
 * and once more when leaving the editor (tech §7.5).
 */
export class ThumbnailScheduler {
  private lastRun = 0;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly capture: () => ThumbnailSnapshot | null,
    private readonly publish: (snapshot: ThumbnailSnapshot) => Promise<void>,
    private readonly intervalMs = THUMBNAIL_INTERVAL_MS,
  ) {}

  /** Call after each successful save. */
  markChanged() {
    this.dirty = true;
    if (this.timer || this.running) return;
    const wait = this.lastRun + this.intervalMs - Date.now();
    this.timer = setTimeout(() => void this.run(), Math.max(0, wait));
  }

  /** Marks the board changed without scheduling (used right before leave()). */
  markDirty() {
    this.dirty = true;
  }

  /** Leaving the editor: publish once more if anything changed. */
  leave(captured?: ThumbnailSnapshot | null): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return this.running ?? Promise.resolve();
    const snapshot = captured !== undefined ? captured : this.capture();
    this.dirty = false;
    if (!snapshot) return Promise.resolve();
    const after = this.running ?? Promise.resolve();
    return after.then(() => this.publish(snapshot)).catch(() => undefined);
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async run() {
    this.timer = null;
    if (!this.dirty) return;
    const snapshot = this.capture();
    if (!snapshot) return;
    this.dirty = false;
    this.lastRun = Date.now();
    this.running = this.publish(snapshot).catch(() => {
      this.dirty = true; // try again next time
    });
    await this.running;
    this.running = null;
    if (this.dirty) this.markChanged();
  }
}
