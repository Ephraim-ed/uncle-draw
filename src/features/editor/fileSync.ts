import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import { IMAGE_MAX_BYTES, IMAGE_MAX_SIDE } from "./constants";

/** Ids in `files` that haven't been uploaded or queued yet. */
export function diffNewFileIds(files: BinaryFiles, known: ReadonlySet<string>): string[] {
  return Object.keys(files).filter((id) => !known.has(id));
}

export type UploadOutcome = "ok" | "tooLarge" | "error";

export interface FileSyncOptions {
  /** Ids already in board_files (loaded with the board). */
  knownIds: Iterable<string>;
  upload: (file: BinaryFileData) => Promise<UploadOutcome>;
  onRejected?: (fileId: string) => void;
  /** Uploaded and recorded: collaborators can fetch it now. */
  onUploaded?: (fileId: string) => void;
  onIdle?: () => void;
  retryAfterMs?: number;
}

/**
 * Uploads new image files in their own queue, separate from scene saves
 * (tech §7.4). A scene may reference a file that is still uploading; loads
 * tolerate missing files.
 */
export class FileSync {
  private known: Set<string>;
  private queue: BinaryFileData[] = [];
  private running = false;
  private retryAt = new Map<string, number>();
  private lastFiles: BinaryFiles | null = null;
  private disposed = false;

  constructor(private readonly opts: FileSyncOptions) {
    this.known = new Set(opts.knownIds);
  }

  /** Called from onChange; cheap when the files map hasn't changed. */
  notify(files: BinaryFiles) {
    if (this.disposed || files === this.lastFiles) return;
    this.lastFiles = files;
    const now = Date.now();
    for (const id of diffNewFileIds(files, this.known)) {
      const retryAt = this.retryAt.get(id);
      if (retryAt && retryAt > now) continue;
      const file = files[id];
      if (!file) continue;
      this.known.add(id);
      this.queue.push(file);
    }
    void this.pump();
  }

  markUploaded(ids: Iterable<string>) {
    for (const id of ids) this.known.add(id);
  }

  get pendingCount(): number {
    return this.queue.length + (this.running ? 1 : 0);
  }

  dispose() {
    this.disposed = true;
    this.queue = [];
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.disposed && this.queue.length > 0) {
        const file = this.queue.shift()!;
        let outcome: UploadOutcome;
        try {
          outcome = await this.opts.upload(file);
        } catch {
          outcome = "error";
        }
        if (outcome === "ok") {
          this.opts.onUploaded?.(file.id);
        } else if (outcome === "tooLarge") {
          this.opts.onRejected?.(file.id);
        } else if (outcome === "error") {
          // Forget it so a later onChange retries, but not immediately.
          this.known.delete(file.id);
          this.retryAt.set(file.id, Date.now() + (this.opts.retryAfterMs ?? 15_000));
          this.lastFiles = null;
        }
      }
    } finally {
      this.running = false;
      if (!this.disposed) this.opts.onIdle?.();
    }
  }
}

// ---------------------------------------------------------------------------
// Image preparation (SAVE-5): downscale anything over 2048 px or 5 MB.

export function dataUrlToBlob(dataURL: string): Blob {
  const [header, data = ""] = dataURL.split(",", 2);
  const mime = /data:([^;,]+)/.exec(header ?? "")?.[1] ?? "application/octet-stream";
  if (header?.includes(";base64")) {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(data)], { type: mime });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read file"));
    reader.readAsDataURL(blob);
  });
}

export type PreparedImage =
  { kind: "ok"; blob: Blob; mimeType: string; replacedDataUrl: string | null } | { kind: "tooLarge" };

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function prepareImage(file: BinaryFileData): Promise<PreparedImage> {
  const blob = dataUrlToBlob(file.dataURL);
  const mimeType = file.mimeType;

  // SVGs aren't rasterized: they're either small enough or rejected.
  if (mimeType === "image/svg+xml") {
    return blob.size <= IMAGE_MAX_BYTES
      ? { kind: "ok", blob, mimeType, replacedDataUrl: null }
      : { kind: "tooLarge" };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return blob.size <= IMAGE_MAX_BYTES
      ? { kind: "ok", blob, mimeType, replacedDataUrl: null }
      : { kind: "tooLarge" };
  }

  const { width, height } = bitmap;
  if (width <= IMAGE_MAX_SIDE && height <= IMAGE_MAX_SIDE && blob.size <= IMAGE_MAX_BYTES) {
    bitmap.close();
    return { kind: "ok", blob, mimeType, replacedDataUrl: null };
  }

  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return { kind: "tooLarge" };
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  for (const quality of [0.9, 0.75, 0.6]) {
    const out = await canvasToBlob(canvas, "image/webp", quality);
    if (out && out.size <= IMAGE_MAX_BYTES) {
      return { kind: "ok", blob: out, mimeType: "image/webp", replacedDataUrl: await blobToDataUrl(out) };
    }
  }
  return { kind: "tooLarge" };
}
