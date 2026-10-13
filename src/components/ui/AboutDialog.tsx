import { useEffect, useState } from "react";
import { PencilMark } from "../../brand/PencilMark";
import type { LICENSES as LicenseList } from "../../legal/licenses";
import { SketchButton, SketchDialog } from "../sketch";

/** About Uncle Draw: credits and third-party license notices (tech §16). */
export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  // The notices are ~13 KB of text: load them only when the dialog opens.
  const [licenses, setLicenses] = useState<typeof LicenseList | null>(null);
  useEffect(() => {
    if (!open || licenses) return;
    let cancelled = false;
    void import("../../legal/licenses").then((m) => !cancelled && setLicenses(m.LICENSES));
    return () => {
      cancelled = true;
    };
  }, [open, licenses]);

  return (
    <SketchDialog
      open={open}
      onClose={onClose}
      title="About Uncle Draw"
      seedKey="about"
      width={560}
      footer={
        <SketchButton variant="primary" onClick={onClose}>
          Close
        </SketchButton>
      }
    >
      <div className="flex items-center gap-3">
        <PencilMark size={40} />
        <p>Sketch it out. Uncle Draw keeps it safe.</p>
      </div>
      <p className="text-ink-muted">
        Built with{" "}
        <a
          className="text-primary underline underline-offset-4"
          href="https://github.com/excalidraw/excalidraw"
          target="_blank"
          rel="noreferrer"
        >
          Excalidraw
        </a>
        , drawn with Rough.js, with icons from Tabler.
      </p>
      <div className="flex max-h-72 flex-col gap-3 overflow-y-auto pr-1">
        {licenses === null ? <p className="text-ink-muted">Loading notices…</p> : null}
        {(licenses ?? []).map((l) => (
          <details key={l.name} className="rounded-sm">
            <summary className="cursor-pointer text-label">
              {l.name} <span className="font-normal text-ink-muted">· {l.license}</span>
            </summary>
            <pre className="mt-2 whitespace-pre-wrap bg-surface-sunken p-3 font-mono text-mono text-ink-muted">
              {l.text}
            </pre>
          </details>
        ))}
      </div>
    </SketchDialog>
  );
}
