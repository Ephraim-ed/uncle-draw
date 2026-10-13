import { useRef, useState, type FormEvent } from "react";
import { useUpdateDisplayName } from "../../features/auth/profile";
import { SketchButton, SketchDialog, SketchInput, useToast } from "../sketch";

/** Edit my display name (AUTH-5). */
export function EditNameDialog({
  open,
  onClose,
  currentName,
}: {
  open: boolean;
  onClose: () => void;
  currentName: string;
}) {
  const [name, setName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);
  const update = useUpdateDisplayName();
  const { toast } = useToast();

  // Reset the draft each time the dialog opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setName(currentName);
  }

  const close = () => {
    update.reset();
    onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) {
      close();
      return;
    }
    update.mutate(trimmed, {
      onSuccess: () => {
        toast({ message: "Name updated." });
        close();
      },
    });
  };

  return (
    <SketchDialog
      open={open}
      onClose={close}
      title="Your name"
      seedKey="edit-name"
      initialFocusRef={inputRef}
    >
      <form onSubmit={submit} className="flex flex-col gap-6">
        <SketchInput
          ref={inputRef}
          label="Display name"
          value={name}
          maxLength={80}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
          error={update.isError ? "Hmm, that didn't save. Try again." : undefined}
        />
        <div className="flex justify-end gap-3">
          <SketchButton onClick={close}>Cancel</SketchButton>
          <SketchButton type="submit" variant="primary" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </SketchButton>
        </div>
      </form>
    </SketchDialog>
  );
}
