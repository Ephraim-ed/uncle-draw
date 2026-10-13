import { IconDots, IconPlus, IconShare } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import { useTheme } from "../app/theme";
import {
  CloudOffDoodle,
  EmptyBoardsDoodle,
  EnvelopeDoodle,
  EraserDoodle,
  PencilHandoffDoodle,
  TornPaperDoodle,
} from "../assets/illustrations";
import { PencilMark } from "../brand/PencilMark";
import { Wordmark } from "../brand/Wordmark";
import {
  Avatar,
  IconButton,
  SketchArt,
  SketchBox,
  SketchButton,
  SketchDialog,
  SketchInput,
  SketchMenu,
  hashSeed,
  useToast,
} from "../components/sketch";
import { SaveStatusPill } from "../features/editor/SaveStatusPill";
import type { SaveStatus } from "../features/editor/saveQueue";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const STATUSES: SaveStatus[] = ["saved", "saving", "offline", "error"];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-hand text-h2">{title}</h2>
      <div className="flex flex-wrap items-center gap-6">{children}</div>
    </section>
  );
}

/** Dev-only component preview: every sketch component in every state (§12). */
export default function KitPage() {
  useDocumentTitle("Sketch kit");
  const { setting, setTheme } = useTheme();
  const { toast } = useToast();
  const [dialog, setDialog] = useState(false);

  return (
    <div className="ud-shell ud-dot-grid min-h-dvh px-4 py-8 tablet:px-6 desktop:px-8">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Wordmark />
          <div className="flex gap-2">
            {(["light", "dark", "system"] as const).map((t) => (
              <SketchButton
                key={t}
                size="sm"
                variant={setting === t ? "primary" : "secondary"}
                onClick={() => setTheme(t)}
              >
                {t}
              </SketchButton>
            ))}
          </div>
        </header>

        <Section title="Type">
          <div className="flex flex-col gap-2">
            <span className="font-hand text-display">Display 40</span>
            <span className="font-hand text-h1">Heading 1 · 28</span>
            <span className="font-hand text-h2">Heading 2 · 20</span>
            <span className="text-body">Body · Assistant 16/24</span>
            <span className="text-label">Label · Assistant 14/20 600</span>
            <span className="text-label font-normal text-ink-muted">Small · 14/20</span>
            <kbd>Ctrl + S</kbd>
          </div>
        </Section>

        <Section title="Buttons">
          <SketchButton variant="primary">Primary</SketchButton>
          <SketchButton variant="primary" hand icon={<IconPlus size={20} stroke={1.75} />}>
            New board
          </SketchButton>
          <SketchButton>Secondary</SketchButton>
          <SketchButton size="sm" icon={<IconShare size={18} stroke={1.75} />}>
            Small
          </SketchButton>
          <SketchButton variant="danger">Move to trash</SketchButton>
          <SketchButton variant="danger-text">Stop sharing</SketchButton>
          <SketchButton variant="primary" disabled>
            Disabled
          </SketchButton>
          <SketchButton disabled>Disabled</SketchButton>
          <IconButton label="More">
            <IconDots size={20} stroke={1.75} />
          </IconButton>
          <IconButton label="Disabled icon" disabled>
            <IconDots size={20} stroke={1.75} />
          </IconButton>
        </Section>

        <Section title="Inputs">
          <div className="w-72">
            <SketchInput label="Email" placeholder="you@example.com" />
          </div>
          <div className="w-72">
            <SketchInput
              label="With error"
              defaultValue="nope"
              error="That doesn't look like an email address."
            />
          </div>
          <div className="w-72">
            <SketchInput label="Disabled" disabled defaultValue="Can't touch this" />
          </div>
          <div className="w-72">
            <SketchInput label="Read-only URL" readOnly defaultValue="https://example.com/s/Xk3pQ…" />
          </div>
        </Section>

        <Section title="Cards, menu, dialog, toast">
          <div className="ud-card ud-sketch w-60">
            <SketchArt seed={hashSeed("kit-card")} shape="rect" fillStyle="solid" shadow />
            <span className="ud-card__well block aspect-[16/10]" />
            <span className="flex flex-col px-4 pt-3 pb-4">
              <span className="truncate font-semibold">Sprint map</span>
              <span className="text-label font-normal text-ink-muted">Edited 2h ago</span>
            </span>
          </div>
          <SketchBox seed={hashSeed("kit-skeleton")} boil shadow={0} className="h-40 w-60" />
          <SketchMenu
            label="Example menu"
            items={[
              { label: "Rename", onSelect: () => toast({ message: "Rename" }) },
              { label: "Share", onSelect: () => toast({ message: "Share" }) },
              { type: "separator" },
              { label: "Move to trash", danger: true, onSelect: () => toast({ message: "Trash" }) },
            ]}
            trigger={(props) => (
              <SketchButton {...props} ref={props.ref}>
                Open menu
              </SketchButton>
            )}
          />
          <SketchButton onClick={() => setDialog(true)}>Open dialog</SketchButton>
          <SketchButton
            onClick={() =>
              toast({
                message: 'Moved "Sprint map" to trash.',
                duration: 5000,
                action: { label: "Undo", onClick: () => {} },
              })
            }
          >
            Show toast
          </SketchButton>
          <Avatar name="Ana" />
          <Avatar name="Ana" url="https://avatars.githubusercontent.com/u/9919?v=4" size={40} />
        </Section>

        <Section title="Save status">
          {STATUSES.map((s) => (
            <SaveStatusPill
              key={s}
              status={s}
              errorReason={s === "error" ? "failed" : null}
              onRetry={() => {}}
            />
          ))}
          <SaveStatusPill status="offline" errorReason={null} iconOnly onRetry={() => {}} />
        </Section>

        <Section title="Brand and illustrations">
          <Wordmark size="display" />
          <PencilMark size={64} />
          <PencilMark size={64} boil />
          <PencilHandoffDoodle />
          <EnvelopeDoodle />
          <EmptyBoardsDoodle />
          <EraserDoodle />
          <TornPaperDoodle />
          <CloudOffDoodle width={48} />
        </Section>
      </div>

      <SketchDialog
        open={dialog}
        onClose={() => setDialog(false)}
        title='Share "Sprint map"'
        footer={
          <>
            <SketchButton onClick={() => setDialog(false)}>Cancel</SketchButton>
            <SketchButton variant="primary" onClick={() => setDialog(false)}>
              Done
            </SketchButton>
          </>
        }
      >
        <p>Anyone with this link can view the board. They can&apos;t edit it.</p>
        <SketchInput label="Share link" hideLabel readOnly defaultValue="https://example.com/s/Xk3pQ…" />
      </SketchDialog>
    </div>
  );
}
