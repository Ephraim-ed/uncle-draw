import { IconCopy } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { Avatar, SketchButton, SketchDialog, SketchInput, useToast } from "../../components/sketch";
import { formatShortDate } from "../../lib/time";
import { useUser } from "../auth/AuthProvider";
import {
  createEditLink,
  editLinkUrl,
  getActiveEditLink,
  listPeople,
  removePerson,
  revokeEditLink,
  rotateEditLink,
} from "./collab.api";
import {
  createShare,
  getActiveShare,
  revokeShare,
  rotateShare,
  shareUrl,
  type ShareLink,
} from "./shares.api";

export const shareKey = (boardId: string) => ["share", boardId] as const;
const editLinkKey = (boardId: string) => ["edit-link", boardId] as const;
const peopleKey = (boardId: string) => ["people", boardId] as const;

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  boardId: string;
  title: string;
  /** Only the owner manages links and people; editors see who's here and can leave. */
  isOwner: boolean;
  /** An editor left the board. */
  onLeft?: () => void;
}

interface LinkApi {
  get: (boardId: string) => Promise<ShareLink | null>;
  create: (boardId: string) => Promise<ShareLink>;
  rotate: (boardId: string) => Promise<ShareLink>;
  revoke: (boardId: string) => Promise<void>;
}

interface LinkSectionProps {
  boardId: string;
  queryKey: readonly unknown[];
  api: LinkApi;
  heading: string;
  description: string;
  createLabel: string;
  revokeLabel: string;
  inputLabel: string;
  urlFor: (token: string) => string;
  rotatedMessage: string;
  revokedMessage: string;
  enabled: boolean;
}

/** One link with Copy, "Get a new link" and a way to turn it off (SHARE-1/3, COLLAB-1). */
function LinkSection({
  boardId,
  queryKey,
  api,
  heading,
  description,
  createLabel,
  revokeLabel,
  inputLabel,
  urlFor,
  rotatedMessage,
  revokedMessage,
  enabled,
}: LinkSectionProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const headingId = useId();

  const query = useQuery({ queryKey, enabled, queryFn: () => api.get(boardId) });
  const setLink = (link: ShareLink | null) => qc.setQueryData(queryKey, link);
  const create = useMutation({ mutationFn: () => api.create(boardId), onSuccess: setLink });
  const rotate = useMutation({
    mutationFn: () => api.rotate(boardId),
    onSuccess: (link) => {
      setLink(link);
      toast({ message: rotatedMessage });
    },
  });
  const revoke = useMutation({
    mutationFn: () => api.revoke(boardId),
    onSuccess: () => {
      setLink(null);
      toast({ message: revokedMessage });
    },
  });

  const busy = create.isPending || rotate.isPending || revoke.isPending;
  const failed = create.isError || rotate.isError || revoke.isError;
  const link = query.data ?? null;
  const url = link ? urlFor(link.token) : "";

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
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div>
        <h3 id={headingId} className="text-body font-semibold">
          {heading}
        </h3>
        <p className="text-ink-muted">{description}</p>
      </div>

      {query.isPending && enabled ? (
        <p className="text-ink-muted" role="status">
          Looking for a link…
        </p>
      ) : query.isError ? (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-danger">Hmm, we couldn&apos;t load this link.</p>
          <SketchButton size="sm" onClick={() => void query.refetch()}>
            Try again
          </SketchButton>
        </div>
      ) : link ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-3">
            <SketchInput
              ref={inputRef}
              label={inputLabel}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SketchButton size="sm" onClick={() => rotate.mutate()} disabled={busy}>
              Get a new link
            </SketchButton>
            <SketchButton size="sm" variant="danger-text" onClick={() => revoke.mutate()} disabled={busy}>
              {revokeLabel}
            </SketchButton>
          </div>
        </div>
      ) : (
        <div>
          <SketchButton variant="primary" onClick={() => create.mutate()} disabled={busy}>
            {create.isPending ? "Creating…" : createLabel}
          </SketchButton>
        </div>
      )}

      {failed ? (
        <p className="text-label text-danger" role="alert">
          Hmm, that didn&apos;t work. Please try again.
        </p>
      ) : null}
    </section>
  );
}

const VIEW_LINKS: LinkApi = {
  get: getActiveShare,
  create: createShare,
  rotate: rotateShare,
  revoke: revokeShare,
};
const EDIT_LINKS: LinkApi = {
  get: getActiveEditLink,
  create: createEditLink,
  rotate: rotateEditLink,
  revoke: revokeEditLink,
};

/** Everyone with edit access (COLLAB-1). The owner removes people; editors can leave. */
function PeopleSection({
  boardId,
  title,
  isOwner,
  enabled,
  onLeft,
}: {
  boardId: string;
  title: string;
  isOwner: boolean;
  enabled: boolean;
  onLeft?: () => void;
}) {
  const me = useUser();
  const qc = useQueryClient();
  const { toast } = useToast();
  const headingId = useId();
  const [confirmLeave, setConfirmLeave] = useState(false);

  // People join through the link at any time: always refresh when the dialog opens.
  const people = useQuery({
    queryKey: peopleKey(boardId),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () => listPeople(boardId),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => removePerson(boardId, userId),
    onSuccess: (_void, userId) => {
      qc.setQueryData(peopleKey(boardId), (list: Awaited<ReturnType<typeof listPeople>> | undefined) =>
        list?.filter((p) => p.userId !== userId),
      );
      if (userId === me.id) onLeft?.();
    },
    onError: () => toast({ message: "Hmm, that didn't work. Please try again." }),
  });

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-body font-semibold">
        People who can edit
      </h3>
      {people.isPending && enabled ? (
        <p className="text-ink-muted" role="status">
          Looking for people…
        </p>
      ) : people.isError ? (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-danger">Hmm, we couldn&apos;t load who has access.</p>
          <SketchButton size="sm" onClick={() => void people.refetch()}>
            Try again
          </SketchButton>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {(people.data ?? []).map((person) => {
            const you = person.userId === me.id;
            return (
              <li key={person.userId} className="flex items-center gap-3">
                <Avatar
                  name={person.name}
                  url={person.avatarUrl}
                  size={28}
                  seedKey={`person:${person.userId}`}
                />
                <span className="min-w-0 flex-1 truncate">
                  {person.name}
                  {you ? <span className="text-ink-muted"> (you)</span> : null}
                </span>
                <span className="text-label font-normal text-ink-muted">
                  {person.role === "owner" ? "Owner" : "Editor"}
                </span>
                {isOwner && person.role !== "owner" ? (
                  <SketchButton
                    size="sm"
                    variant="danger-text"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(person.userId)}
                    aria-label={`Remove ${person.name}`}
                  >
                    Remove
                  </SketchButton>
                ) : null}
              </li>
            );
          })}
          {isOwner && people.data?.length === 1 ? (
            <li className="text-ink-muted">Nobody else yet. Send someone the edit link.</li>
          ) : null}
        </ul>
      )}

      {!isOwner ? (
        confirmLeave ? (
          <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Leave this board?">
            <p className="flex-1">
              Leave &ldquo;{title}&rdquo;? You&apos;ll need the edit link to come back.
            </p>
            <SketchButton size="sm" onClick={() => setConfirmLeave(false)}>
              Cancel
            </SketchButton>
            <SketchButton
              size="sm"
              variant="danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(me.id)}
            >
              Leave
            </SketchButton>
          </div>
        ) : (
          <div>
            <SketchButton size="sm" variant="danger-text" onClick={() => setConfirmLeave(true)}>
              Leave this board
            </SketchButton>
          </div>
        )
      ) : null}
    </section>
  );
}

/** Share dialog (SHARE-1, SHARE-3, COLLAB-1; VISUAL_DESIGN.md §6.5). */
export function ShareDialog({ open, onClose, boardId, title, isOwner, onLeft }: ShareDialogProps) {
  return (
    <SketchDialog
      open={open}
      onClose={onClose}
      title={`Share "${title}"`}
      seedKey={`share:${boardId}`}
      width={560}
    >
      {isOwner ? (
        <>
          <LinkSection
            boardId={boardId}
            queryKey={shareKey(boardId)}
            api={VIEW_LINKS}
            heading="View-only link"
            description="Anyone with this link can view the board. They can't edit it."
            createLabel="Create share link"
            revokeLabel="Stop sharing"
            inputLabel="Share link"
            urlFor={shareUrl}
            rotatedMessage="New link ready. The old one no longer works."
            revokedMessage="Sharing stopped. The link no longer works."
            enabled={open}
          />
          <LinkSection
            boardId={boardId}
            queryKey={editLinkKey(boardId)}
            api={EDIT_LINKS}
            heading="Edit link"
            description="Anyone who opens this link and signs in can draw on this board with you, live."
            createLabel="Create edit link"
            revokeLabel="Turn off"
            inputLabel="Edit link"
            urlFor={editLinkUrl}
            rotatedMessage="New edit link ready. The old one no longer works."
            revokedMessage="Edit link turned off. People who already joined can still edit."
            enabled={open}
          />
        </>
      ) : (
        <p>You can edit this board. Only its owner can share it or change who has access.</p>
      )}
      <PeopleSection boardId={boardId} title={title} isOwner={isOwner} enabled={open} onLeft={onLeft} />
    </SketchDialog>
  );
}
