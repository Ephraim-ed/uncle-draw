import { IconCheck, IconPointer, IconX } from "@tabler/icons-react";
import { useSyncExternalStore } from "react";
import { IconButton, SketchArt, hashSeed } from "../../../components/sketch";
import type { LiveControls } from "./LiveBar";

const ICON = { size: 18, stroke: 1.75 } as const;

/**
 * Viewers' pointers on my shared screen (COLLAB-8): who asked to point, with
 * Allow and Deny, and a named cursor for each viewer I allowed. Cursors sit
 * at the same fraction of this window as the viewer's mouse is over the
 * picture, so they show up in the share when the shared screen is this window.
 */
export function ScreenPointers({
  controls,
}: {
  controls: Pick<LiveControls, "subscribeLive" | "getLive" | "answerPointer">;
}) {
  const live = useSyncExternalStore(controls.subscribeLive, controls.getLive);
  if (live.pointerRequests.length === 0 && live.pointers.length === 0) return null;
  return (
    <>
      {live.pointerRequests.length > 0 ? (
        <section className="ud-pointer-asks ud-sketch" aria-label="Pointer requests">
          <SketchArt
            seed={hashSeed("pointer-asks")}
            shape="rect"
            fillStyle="solid"
            shadow
            strokeWidth={1.5}
          />
          {live.pointerRequests.map((ask) => (
            <div key={ask.sessionId} className="ud-pointer-asks__row">
              <span className="ud-pointer-asks__text">
                <span className="ud-livebar__name">{ask.name}</span> wants to point at your screen
              </span>
              <IconButton
                label={`Allow ${ask.name}`}
                onClick={() => controls.answerPointer(ask.sessionId, true)}
              >
                <IconCheck {...ICON} />
              </IconButton>
              <IconButton
                label={`Deny ${ask.name}`}
                onClick={() => controls.answerPointer(ask.sessionId, false)}
              >
                <IconX {...ICON} />
              </IconButton>
            </div>
          ))}
        </section>
      ) : null}
      <div className="ud-pointers" aria-hidden="true">
        {live.pointers.map((p) => (
          <div
            key={p.sessionId}
            className="ud-pointers__cursor"
            data-testid={`pointer-${p.sessionId}`}
            style={{
              left: `${p.x * 100}%`,
              top: `${p.y * 100}%`,
              ["--ud-pointer-hue" as string]: hashSeed(p.sessionId) % 360,
            }}
          >
            <IconPointer size={22} stroke={1.5} fill="currentColor" />
            <span className="ud-pointers__name">{p.name}</span>
          </div>
        ))}
      </div>
    </>
  );
}
