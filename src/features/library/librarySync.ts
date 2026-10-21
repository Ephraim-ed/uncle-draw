import type { LibraryItems } from "@excalidraw/excalidraw/types";
import { loadLibrary, saveLibrary } from "./library.api";

/** Library edits come in bursts (add, rename, remove); save once they settle. */
const SAVE_DELAY_MS = 800;

/**
 * Keeps my Excalidraw library in step with my account (LIB-1): loads it for
 * the editor, saves every change (last write wins, like the sidebar itself),
 * and retries when the browser comes back online. React reads the items to
 * list "My templates".
 */
export class LibrarySync {
  private items: LibraryItems = [];
  private saved = "[]";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failed = false;
  private listeners = new Set<() => void>();
  private loading: Promise<LibraryItems> | null = null;

  constructor(
    private readonly userId: string,
    private readonly api = { load: loadLibrary, save: saveLibrary },
    private readonly onError: () => void = () => {},
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getItems = () => this.items;

  /** The saved library, for Excalidraw's `initialData.libraryItems`. Loads once. */
  load = (): Promise<LibraryItems> => {
    this.loading ??= this.api.load(this.userId).then(
      (items) => {
        this.saved = JSON.stringify(items);
        this.set(items);
        return items;
      },
      () => [] as LibraryItems, // the editor still opens; the next change saves what's there
    );
    return this.loading;
  };

  /** Excalidraw's `onLibraryChange`. */
  handleChange = (items: LibraryItems) => {
    this.set(items);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  };

  /** Saves now if anything changed; a failure retries on the next change or when back online. */
  flush = async () => {
    clearTimeout(this.timer);
    const items = this.items;
    const json = JSON.stringify(items);
    if (json === this.saved) return;
    try {
      await this.api.save(this.userId, items);
      this.saved = json;
      this.failed = false;
    } catch {
      if (!this.failed) this.onError();
      this.failed = true;
    }
  };

  /** Starts retrying on `online`; returns the cleanup. */
  start = () => {
    const onOnline = () => void this.flush();
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      void this.flush();
    };
  };

  private set(items: LibraryItems) {
    if (items === this.items) return;
    this.items = items;
    this.listeners.forEach((l) => l());
  }
}
