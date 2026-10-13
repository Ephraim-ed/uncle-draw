import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { SketchArt } from "./SketchArt";
import { hashSeed } from "./seed";

export interface ToastOptions {
  message: ReactNode;
  action?: { label: string; onClick: () => void };
  /** ms before auto-dismiss. Default 3 s (§8); Undo toasts use 5 s (DASH-4). */
  duration?: number;
  /** Replaces an existing toast with the same id instead of stacking. */
  id?: string;
}

interface ToastItem extends ToastOptions {
  key: number;
  id: string;
}

interface ToastApi {
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let counter = 0;

/** Sticky-note toasts: yellow paper, ink text in both themes, slightly rotated. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setToasts((all) => all.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const key = ++counter;
      const id = options.id ?? `toast-${key}`;
      setToasts((all) => [...all.filter((t) => t.id !== id), { ...options, id, key }].slice(-3));
      const existing = timers.current.get(id);
      if (existing) window.clearTimeout(existing);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), options.duration ?? 3000),
      );
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => window.clearTimeout(t));
  }, []);

  // Modal <dialog>s live in the top layer, so a plain fixed region would be
  // hidden behind them. Re-showing the region as a manual popover puts it on
  // top of whatever opened last.
  const regionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = regionRef.current;
    if (!el || typeof el.showPopover !== "function") return;
    try {
      if (el.matches(":popover-open")) el.hidePopover();
      if (toasts.length > 0) el.showPopover();
    } catch {
      // Popover API unavailable: the region stays a normal fixed element.
    }
  }, [toasts]);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Always-present live region: the popover is display:none while empty,
          and newly displayed live regions aren't reliably announced. */}
      <div className="ud-visually-hidden" role="status" aria-live="polite">
        {toasts.map((t) => (typeof t.message === "string" ? <p key={t.key}>{t.message}</p> : null))}
      </div>
      {typeof document !== "undefined"
        ? createPortal(
            <div ref={regionRef} popover="manual" className="ud-toasts ud-shell">
              {toasts.map((t) => (
                <div key={t.key} className="ud-toast ud-sketch">
                  <SketchArt seed={hashSeed(t.id)} shape="rect" fillStyle="solid" stroke={false} shadow />
                  <span className="ud-toast__msg">{t.message}</span>
                  {t.action ? (
                    <button
                      type="button"
                      className="ud-toast__action"
                      onClick={() => {
                        t.action!.onClick();
                        dismiss(t.id);
                      }}
                    >
                      {t.action.label}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
