import { useRef } from "react";
import { SketchButton, SketchDialog } from "../../components/sketch";

/** "Move "Sprint map" to trash?" (DASH-4; copy from VISUAL_DESIGN.md §2). */
export function TrashConfirmDialog({
  title,
  open,
  onCancel,
  onConfirm,
}: {
  title: string;
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <SketchDialog
      open={open}
      onClose={onCancel}
      title={`Move "${title}" to trash?`}
      seedKey="trash-confirm"
      initialFocusRef={cancelRef}
      footer={
        <>
          <SketchButton ref={cancelRef} onClick={onCancel}>
            Cancel
          </SketchButton>
          <SketchButton variant="danger" onClick={onConfirm}>
            Move to trash
          </SketchButton>
        </>
      }
    >
      <p>You can restore it for 30 days.</p>
    </SketchDialog>
  );
}
