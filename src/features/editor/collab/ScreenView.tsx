import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconChevronUp,
  IconDeviceDesktop,
  IconMinus,
  IconPointer,
  IconPointerOff,
} from "@tabler/icons-react";
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
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
export function ScreenView({
  controls,
}: {
  controls: Pick<
    LiveControls,
    "subscribeLive" | "getLive" | "requestPointer" | "stopPointer" | "sendPointerMove"
  >;
}) {
  const live = useSyncExternalStore(controls.subscribeLive, controls.getLive);
  const [large, setLarge] = useState(false);
  /** The sharer whose screen I tucked away; a new sharer shows again. */
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const sharer = live.sharer;
  if (!sharer || sharer.isMe) return null;

  const title = `${sharer.name}'s screen`;
  const access = live.pointerAccess;
  // Fractions of the picture itself, not of the letterboxed video element.
  const point = (e: PointerEvent<HTMLDivElement>) => {
    if (access !== "granted") return;
    const video = e.currentTarget.querySelector("video");
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const box = video.getBoundingClientRect();
    const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    const x = (e.clientX - (box.left + (box.width - width) / 2)) / width;
    const y = (e.clientY - (box.top + (box.height - height) / 2)) / height;
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) controls.sendPointerMove(x, y);
  };
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
            {live.screenStream ? (
              access === "granted" || access === "requested" ? (
                <IconButton
                  label={access === "granted" ? "Stop pointer" : "Cancel pointer request"}
                  aria-pressed={access === "granted"}
                  onClick={controls.stopPointer}
                >
                  <IconPointerOff {...ICON} />
                </IconButton>
              ) : (
                <IconButton
                  label={access === "denied" ? "Request pointer again" : "Request pointer"}
                  title={`Ask ${sharer.name} to let you point at their screen`}
                  onClick={controls.requestPointer}
                >
                  <IconPointer {...ICON} />
                </IconButton>
              )
            ) : null}
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
        <div
          className="ud-screen__well"
          data-pointing={access === "granted" || undefined}
          onDoubleClick={() => setLarge(!large)}
          onPointerMove={point}
        >
          {live.screenFull ? (
            <p className="ud-screen__note">
              {SCREEN_MAX_VIEWERS} people are watching already. You&apos;ll see it as soon as there&apos;s
              room.
            </p>
          ) : live.screenStream ? (
            <>
              <ScreenVideo stream={live.screenStream} label={title} />
              {access === "requested" || access === "denied" ? (
                <p className="ud-screen__toast" role="status">
                  {access === "requested"
                    ? `Waiting for ${sharer.name} to allow your pointer…`
                    : `${sharer.name} didn't allow a pointer.`}
                </p>
              ) : null}
            </>
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
