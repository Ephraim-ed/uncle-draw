import { PencilMark } from "../../brand/PencilMark";

/** Loading state: the boiling pencil mark (§8, §9.3). */
export function Splash({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      className="ud-shell ud-dot-grid flex min-h-dvh items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 text-ink-muted">
        <PencilMark size={56} boil />
        <span className="text-label">{label}</span>
      </div>
    </div>
  );
}
