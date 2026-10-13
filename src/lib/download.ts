/** Triggers a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A board title made safe for a file name. */
export function fileNameFor(title: string): string {
  const printable = Array.from(title)
    .filter((ch) => ch.charCodeAt(0) >= 0x20)
    .join("");
  const cleaned = printable
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "Untitled board";
}
