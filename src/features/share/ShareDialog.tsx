import { IconCopy } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { SketchButton, SketchDialog, SketchInput, useToast } from "../../components/sketch";
import { formatShortDate } from "../../lib/time";
import {
  createShare,
  getActiveShare,
  revokeShare,
  rotateShare,
  shareUrl,
  type ShareLink,
} from "./shares.api";

export const shareKey = (boardId: string) => ["share", boardId] as const;

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  boardId: string;
  title: string;
}

/** Share dialog (SHARE-1, SHARE-3; VISUAL_DESIGN.md §6.5). */
export function ShareDialog({ open, onClose, boardId, title }: ShareDialogProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const key = shareKey(boardId);

  const share = useQuery({
    queryKey: key,
    enabled: open,
    queryFn: () => getActiveShare(boardId),
  });

  const setShare = (link: ShareLink | null) => qc.setQueryData(key, link);
  const create = useMutation({ mutationFn: () => createShare(boardId), onSuccess: setShare });
  const rotate = useMutation({
    mutationFn: () => rotateShare(boardId),
    onSuccess: (link) => {
      setShare(link);
      toast({ message: "New link ready. The old one no longer works." });
    },
  });
  const revoke = useMutation({
    mutationFn: () => revokeShare(boardId),
    onSuccess: () => {
      setShare(null);
      toast({ message: "Sharing stopped. The link no longer works." });
    },
  });

  const busy = create.isPending || rotate.isPending || revoke.isPending;
  const failed = create.isError || rotate.isError || revoke.isError;
  const link = share.data ?? null;
  const url = link ? shareUrl(link.token) : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ message: "Link copied!", id: "link-copied" });
    } catch {
      inputRef.current?.select();
      toast({ message: "Press Ctrl+C (or ⌘C) to copy the selected link.", id: "link-copied" });
    }
  };

  return (
    <SketchDialog
      open={open}
      onClose={onClose}
      title={`Share "${title}"`}
      seedKey={`share:${boardId}`}
      width={540}
      footer={
        link ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <SketchButton onClick={() => rotate.mutate()} disabled={busy}>
              Get a new link
            </SketchButton>
            <SketchButton variant="danger-text" onClick={() => revoke.mutate()} disabled={busy}>
              Stop sharing
            </SketchButton>
          </div>
        ) : null
      }
    >
      <p>
        Anyone with this link can view the board.
        <br />
        They can&apos;t edit it.
      </p>

      {share.isPending && open ? (
        <p className="text-ink-muted" role="status">
          Looking for a link…
        </p>
      ) : share.isError ? (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-danger">Hmm, we couldn&apos;t load the share link.</p>
          <SketchButton size="sm" onClick={() => void share.refetch()}>
            Try again
          </SketchButton>
        </div>
      ) : link ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-3">
            <SketchInput
              ref={inputRef}
              label="Share link"
              hideLabel
              readOnly
              value={url}
              className="min-w-0 flex-1"
              onFocus={(e) => e.currentTarget.select()}
            />
            <SketchButton icon={<IconCopy size={20} stroke={1.75} />} onClick={() => void copy()}>
              Copy
            </SketchButton>
          </div>
          <p className="text-label font-normal text-ink-muted">
            Created {formatShortDate(link.created_at)} ·{" "}
            {link.expires_at ? `Expires ${formatShortDate(link.expires_at)}` : "Never expires"}
          </p>
        </div>
      ) : (
        <div>
          <SketchButton variant="primary" onClick={() => create.mutate()} disabled={busy}>
            {create.isPending ? "Creating…" : "Create share link"}
          </SketchButton>
        </div>
      )}

      {failed ? (
        <p className="text-label text-danger" role="alert">
          Hmm, that didn&apos;t work. Please try again.
        </p>
      ) : null}
    </SketchDialog>
  );
}
