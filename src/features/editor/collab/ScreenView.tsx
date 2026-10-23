import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconChevronUp,
  IconDeviceDesktop,
  IconMinus,
} from "@tabler/icons-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconButton, SketchArt, hashSeed } from "../../../components/sketch";
import { SCREEN_MAX_VIEWERS } from "../constants";
import type { LiveControls } from "./LiveBar";

const ICON = { size: 18, stroke: 1.75 } as const;

function ScreenVideo({ stream, label }: { stream: MediaStream; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    // Muted video may always autoplay; this only covers browsers that wait.
    video.play()?.catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [stream]);
  return <video ref={ref} className="ud-screen__video" autoPlay muted playsInline aria-label={label} />;
}

/**
 * Someone's shared screen (COLLAB-7): a panel over the canvas that everyone
 * else gets automatically. It can grow to fill the canvas or tuck away into
 * its title bar. Double-click the picture to switch sizes.
 */
export function ScreenView({ controls }: { controls: Pick<LiveControls, "subscribeLive" | "getLive"> }) {
  const live = useSyncExternalStore(controls.subscribeLive, controls.getLive);
  const [large, setLarge] = useState(false);
  /** The sharer whose screen I tucked away; a new sharer shows again. */
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const sharer = live.sharer;
  if (!sharer || sharer.isMe) return null;

  const title = `${sharer.name}'s screen`;
  const hidden = hiddenFor === sharer.sessionId;
  return (
    <section
      className="ud-screen ud-sketch"
      aria-label={title}
      data-large={(large && !hidden) || undefined}
      data-hidden={hidden || undefined}
    >
      <SketchArt seed={hashSeed("screenview")} shape="rect" fillStyle="solid" shadow strokeWidth={1.5} />
      <div className="ud-screen__bar">
        <span className="ud-screen__icon" aria-hidden="true">
          <IconDeviceDesktop {...ICON} />
        </span>
        <span className="ud-screen__title">{title}</span>
        {hidden ? (
          <IconButton label={`Show ${title}`} onClick={() => setHiddenFor(null)}>
            <IconChevronUp {...ICON} />
          </IconButton>
        ) : (
          <>
            <IconButton label={large ? "Make smaller" : "Make bigger"} onClick={() => setLarge(!large)}>
              {large ? <IconArrowsMinimize {...ICON} /> : <IconArrowsMaximize {...ICON} />}
            </IconButton>
            <IconButton label="Hide" onClick={() => setHiddenFor(sharer.sessionId)}>
              <IconMinus {...ICON} />
            </IconButton>
          </>
        )}
      </div>
      {hidden ? null : (
        <div className="ud-screen__well" onDoubleClick={() => setLarge(!large)}>
          {live.screenFull ? (
            <p className="ud-screen__note">
              {SCREEN_MAX_VIEWERS} people are watching already. You&apos;ll see it as soon as there&apos;s
              room.
            </p>
          ) : live.screenStream ? (
            <ScreenVideo stream={live.screenStream} label={title} />
          ) : (
            <p className="ud-screen__note" role="status">
              Connecting…
            </p>
          )}
        </div>
      )}
    </section>
  );
}
