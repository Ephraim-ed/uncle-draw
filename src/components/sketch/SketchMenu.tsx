import { IconCheck } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { SketchArt } from "./SketchArt";
import { hashSeed } from "./seed";

export type MenuEntry =
  | {
      type?: "item";
      label: ReactNode;
      onSelect: () => void;
      icon?: ReactNode;
      danger?: boolean;
      disabled?: boolean;
      /** Renders as menuitemradio when defined. */
      checked?: boolean;
      key?: string;
    }
  | { type: "separator"; key?: string }
  | { type: "label"; label: ReactNode; key?: string };

export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  id: string;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}

export interface SketchMenuProps {
  /** Accessible name of the menu. */
  label: string;
  items: readonly MenuEntry[];
  trigger: (props: MenuTriggerProps) => ReactNode;
  align?: "start" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  seedKey?: string;
  minWidth?: number;
}

type Position = { top: number; left?: number; right?: number };

/**
 * Menu button following the WAI-ARIA pattern: arrow keys move, Home/End jump,
 * Esc closes and returns focus to the trigger, Tab closes (§10).
 */
export function SketchMenu({
  label,
  items,
  trigger,
  align = "start",
  open: controlledOpen,
  onOpenChange,
  seedKey,
  minWidth = 200,
}: SketchMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const menuId = useId();
  const [position, setPosition] = useState<Position | null>(null);
  const focusOnOpen = useRef<"first" | "last">("first");

  const focusItem = (which: "first" | "last" | number) => {
    const nodes = menuRef.current?.querySelectorAll<HTMLElement>(
      '[role^="menuitem"]:not([aria-disabled="true"])',
    );
    if (!nodes || nodes.length === 0) return;
    const idx = which === "first" ? 0 : which === "last" ? nodes.length - 1 : which;
    nodes[(idx + nodes.length) % nodes.length]?.focus();
  };

  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) triggerRef.current?.focus();
    },
    [setOpen],
  );

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const top = r.bottom + 6;
      setPosition(
        align === "end"
          ? { top, right: Math.max(8, window.innerWidth - r.right) }
          : { top, left: Math.max(8, r.left) },
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => focusItem(focusOnOpen.current));
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.cancelAnimationFrame(id);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, close]);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusOnOpen.current = e.key === "ArrowUp" ? "last" : "first";
      if (open) focusItem(focusOnOpen.current);
      else setOpen(true);
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const nodes = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [],
    );
    const current = nodes.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusItem(current + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusItem(current - 1);
        break;
      case "Home":
        e.preventDefault();
        focusItem("first");
        break;
      case "End":
        e.preventDefault();
        focusItem("last");
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  const select = (entry: Extract<MenuEntry, { onSelect: () => void }>) => {
    close(true);
    entry.onSelect();
  };

  const baseSeed = hashSeed(seedKey ?? `menu:${label}`);

  return (
    <>
      {trigger({
        ref: triggerRef,
        id: triggerId,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? menuId : undefined,
        onClick: () => {
          focusOnOpen.current = "first";
          setOpen(!open);
        },
        onKeyDown: onTriggerKeyDown,
      })}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={label}
              aria-labelledby={label ? undefined : triggerId}
              className="ud-menu ud-sketch ud-shell"
              style={{
                top: position?.top ?? -9999,
                left: position?.left,
                right: position?.right,
                minWidth,
              }}
              onKeyDown={onMenuKeyDown}
            >
              <SketchArt seed={baseSeed} shape="rect" fillStyle="solid" shadow />
              {items.map((entry, i) => {
                const key = entry.key ?? String(i);
                if (entry.type === "separator")
                  return <div key={key} role="separator" className="ud-menu__sep" />;
                if (entry.type === "label")
                  return (
                    <div key={key} className="ud-menu__label" role="presentation">
                      {entry.label}
                    </div>
                  );
                const radio = entry.checked !== undefined;
                return (
                  <div
                    key={key}
                    role={radio ? "menuitemradio" : "menuitem"}
                    aria-checked={radio ? entry.checked : undefined}
                    aria-disabled={entry.disabled || undefined}
                    tabIndex={-1}
                    className={["ud-menu__item", "ud-sketch", entry.danger ? "ud-menu__item--danger" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => !entry.disabled && select(entry)}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && !entry.disabled) {
                        e.preventDefault();
                        select(entry);
                      }
                    }}
                  >
                    <SketchArt
                      seed={baseSeed + i + 1}
                      shape="rect"
                      fillStyle="hachure"
                      stroke={false}
                      className="ud-menu__hl"
                    />
                    <span className="ud-menu__icon" aria-hidden="true">
                      {radio ? entry.checked ? <IconCheck size={16} stroke={1.75} /> : null : entry.icon}
                    </span>
                    <span className="ud-menu__text">{entry.label}</span>
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
