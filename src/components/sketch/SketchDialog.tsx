import { IconX } from "@tabler/icons-react";
import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./SketchButton";
import { SketchArt } from "./SketchArt";
import { hashSeed } from "./seed";

export interface SketchDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** false: Esc, the backdrop and the ✕ don't close it (e.g. the conflict dialog needs a choice). */
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  seedKey?: string;
  width?: number;
}

const OUT_MS = 100;

function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Native <dialog> with showModal(): focus is trapped and the rest of the page
 * is inert. Portaled to <body> so it never inherits Excalidraw's styles or
 * keyboard handling. Focus returns to the trigger on close (§10).
 */
export function SketchDialog({
  open,
  onClose,
  title,
  children,
  footer,
  dismissible = true,
  initialFocusRef,
  seedKey,
  width = 480,
}: SketchDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Open / close the native dialog; the out-animation runs via a data attribute.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      delete dialog.dataset.closing;
      dialog.showModal();
      initialFocusRef?.current?.focus();
    } else if (!open && dialog.open) {
      if (prefersReducedMotion()) {
        dialog.close();
        return;
      }
      dialog.dataset.closing = "";
      const id = window.setTimeout(() => {
        delete dialog.dataset.closing;
        dialog.close();
      }, OUT_MS);
      return () => {
        window.clearTimeout(id);
        delete dialog.dataset.closing;
        if (!open) dialog.close();
      };
    }
  }, [open, initialFocusRef]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => {
      const target = returnFocus.current;
      returnFocus.current = null;
      if (target && target.isConnected) target.focus();
    };
    const handleCancel = (e: Event) => {
      e.preventDefault();
      if (dismissible) onCloseRef.current();
    };
    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("cancel", handleCancel);
    return () => {
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("cancel", handleCancel);
    };
  }, [dismissible]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <dialog
      ref={ref}
      className="ud-dialog ud-shell"
      aria-labelledby={titleId}
      style={{ maxWidth: `min(${width}px, calc(100vw - 32px))` }}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ud-dialog__panel ud-sketch">
        <SketchArt
          seed={hashSeed(seedKey ?? "dialog")}
          shape="rect"
          fillStyle="solid"
          shadow
          strokeWidth={1.5}
        />
        <div className="ud-dialog__header">
          <h2 id={titleId} className="ud-dialog__title">
            {title}
          </h2>
          {dismissible ? (
            <IconButton label="Close" onClick={onClose} className="ud-dialog__close">
              <IconX size={20} stroke={1.75} />
            </IconButton>
          ) : null}
        </div>
        <div className="ud-dialog__body">{children}</div>
        {footer ? <div className="ud-dialog__footer">{footer}</div> : null}
      </div>
    </dialog>,
    document.body,
  );
}
