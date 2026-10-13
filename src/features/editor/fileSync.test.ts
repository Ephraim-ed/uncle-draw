import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import { describe, expect, it, vi } from "vitest";
import { FileSync, dataUrlToBlob, diffNewFileIds, prepareImage } from "./fileSync";

const file = (id: string, mimeType = "image/png", dataURL = "data:image/png;base64,AAAA"): BinaryFileData =>
  ({ id, mimeType, dataURL, created: 1 }) as BinaryFileData;

const files = (...ids: string[]): BinaryFiles =>
  Object.fromEntries(ids.map((id) => [id, file(id)])) as BinaryFiles;

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("diffNewFileIds (tech §7.4)", () => {
  it("returns only ids not yet uploaded", () => {
    expect(diffNewFileIds(files("a", "b", "c"), new Set(["b"]))).toEqual(["a", "c"]);
    expect(diffNewFileIds(files(), new Set(["b"]))).toEqual([]);
  });
});

describe("FileSync", () => {
  it("uploads new files once, in order, skipping known ones", async () => {
    const upload = vi.fn(async (_file: BinaryFileData) => "ok" as const);
    const sync = new FileSync({ knownIds: ["a"], upload });
    sync.notify(files("a", "b", "c"));
    sync.notify(files("a", "b", "c")); // same ids again: nothing new
    await tick();
    await tick();
    expect(upload.mock.calls.map(([f]) => f.id)).toEqual(["b", "c"]);
    expect(sync.pendingCount).toBe(0);
  });

  it("does nothing when the files object hasn't changed", () => {
    const upload = vi.fn(async () => "ok" as const);
    const sync = new FileSync({ knownIds: [], upload });
    const same = files("a");
    sync.notify(same);
    sync.notify(same);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("reports files that are too large", async () => {
    const onRejected = vi.fn();
    const sync = new FileSync({ knownIds: [], upload: async () => "tooLarge", onRejected });
    sync.notify(files("big"));
    await tick();
    expect(onRejected).toHaveBeenCalledWith("big");
  });

  it("retries a failed upload later, not immediately", async () => {
    vi.useFakeTimers();
    try {
      const upload = vi
        .fn<(f: BinaryFileData) => Promise<"ok" | "error">>()
        .mockResolvedValueOnce("error")
        .mockResolvedValue("ok");
      const sync = new FileSync({ knownIds: [], upload, retryAfterMs: 15_000 });
      sync.notify(files("a"));
      await vi.advanceTimersByTimeAsync(0);
      sync.notify(files("a"));
      await vi.advanceTimersByTimeAsync(0);
      expect(upload).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(15_001);
      sync.notify(files("a"));
      await vi.advanceTimersByTimeAsync(0);
      expect(upload).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("image preparation (SAVE-5)", () => {
  it("decodes base64 data URLs", async () => {
    const blob = dataUrlToBlob("data:image/png;base64,aGVsbG8=");
    expect(blob.type).toBe("image/png");
    expect(await blob.text()).toBe("hello");
  });

  it("passes small SVGs through untouched", async () => {
    const svg = `data:image/svg+xml;base64,${btoa("<svg xmlns='http://www.w3.org/2000/svg'/>")}`;
    const out = await prepareImage(file("s", "image/svg+xml", svg));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.mimeType).toBe("image/svg+xml");
      expect(out.replacedDataUrl).toBeNull();
    }
  });

  it("rejects SVGs over 5 MB", async () => {
    const big = `data:image/svg+xml;base64,${btoa("x".repeat(5 * 1024 * 1024 + 10))}`;
    expect((await prepareImage(file("s", "image/svg+xml", big))).kind).toBe("tooLarge");
  });
});
