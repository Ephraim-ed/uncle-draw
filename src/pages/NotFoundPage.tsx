import { EraserDoodle } from "../assets/illustrations";
import { SketchLinkButton } from "../components/sketch";
import { FullPageMessage } from "../components/ui/FullPageMessage";
import { useDocumentTitle } from "../lib/useDocumentTitle";

/** 404 (VISUAL_DESIGN.md §6.6). */
export function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <FullPageMessage
      doodle={<EraserDoodle width={220} />}
      title="This page got erased."
      actions={
        <SketchLinkButton to="/boards" variant="primary">
          Back to your boards
        </SketchLinkButton>
      }
    />
  );
}
