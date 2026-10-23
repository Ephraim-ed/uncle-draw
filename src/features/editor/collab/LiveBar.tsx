import {
  IconEye,
  IconHeadphones,
  IconMicrophone,
  IconMicrophoneOff,
  IconPhoneOff,
  IconPresentation,
  IconPresentationOff,
  IconScreenShare,
  IconScreenShareOff,
} from "@tabler/icons-react";
import { useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from "react";
import { IconButton, SketchArt, hashSeed, useToast } from "../../../components/sketch";
import { VOICE_MAX_PEOPLE } from "../constants";
import type { LiveState } from "./CollabSession";
import { micErrorMessage } from "./micError";

/** What the bar needs from the editor session. */
export interface LiveControls {
  subscribeLive: (listener: () => void) => () => void;
  getLive: () => LiveState;
  joinVoice: () => Promise<void>;
  leaveVoice: () => void;
  setMuted: (muted: boolean) => void;
  startPresenting: () => void;
  stopPresenting: () => void;
  followPresenter: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
}

const ICON = { size: 18, stroke: 1.75 } as const;

/** A ghost button with an icon and a label: the bar is the frame (like the table bar). */
function TextButton({
  icon,
  children,
  ...rest
}: { icon: ReactNode; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="ud-livebar__btn" {...rest}>
      <span className="ud-livebar__icon" aria-hidden="true">
        {icon}
      </span>
      {children}
    </button>
  );
}

/**
 * Voice chat, presenter mode and screen sharing controls (COLLAB-5…7). Shows
 * up once someone else is on the board. In the footer by the help button on
 * wider screens; icons only, under the toolbar, on phones (`compact`).
 */
export function LiveBar({ controls, compact }: { controls: LiveControls; compact: boolean }) {
  const live = useSyncExternalStore(controls.subscribeLive, controls.getLive);
  const { toast } = useToast();
  const presenter = live.presenter;
  const sharer = live.sharer;
  if (live.others === 0 && live.voice === "off" && !presenter?.isMe && live.screen === "off") return null;

  const joinVoice = () => {
    controls.joinVoice().catch((error: unknown) => {
      toast({ message: micErrorMessage(error), duration: 7000, id: "live" });
    });
  };

  const startScreenShare = () => {
    controls.startScreenShare().catch((error: unknown) => {
      // Cancelling the browser's picker isn't an error.
      if (error instanceof DOMException && error.name === "NotAllowedError") return;
      toast({ message: "Hmm, screen sharing didn't start. Try again.", id: "live" });
    });
  };

  const talking = live.inCall === 1 ? "1 person talking" : `${live.inCall} people talking`;
  const voice =
    live.voice === "on" ? (
      <>
        <IconButton
          label={live.muted ? "Unmute" : "Mute"}
          aria-pressed={live.muted}
          className={live.muted ? "ud-livebar__muted" : undefined}
          onClick={() => controls.setMuted(!live.muted)}
        >
          {live.muted ? <IconMicrophoneOff {...ICON} /> : <IconMicrophone {...ICON} />}
        </IconButton>
        <IconButton label="Leave voice" className="ud-livebar__leave" onClick={controls.leaveVoice}>
          <IconPhoneOff {...ICON} />
        </IconButton>
      </>
    ) : compact ? (
      <IconButton
        label={
          live.voice === "joining" ? "Connecting to voice…" : live.voiceFull ? "Voice is full" : "Join voice"
        }
        disabled={live.voice === "joining" || live.voiceFull}
        onClick={joinVoice}
      >
        <IconHeadphones {...ICON} />
      </IconButton>
    ) : (
      <TextButton
        icon={<IconHeadphones {...ICON} />}
        disabled={live.voice === "joining" || live.voiceFull}
        title={
          live.voiceFull
            ? `Voice is full (${VOICE_MAX_PEOPLE} people)`
            : live.inCall > 0
              ? `Talk with everyone here (${talking})`
              : "Talk with everyone here"
        }
        onClick={joinVoice}
      >
        {live.voice === "joining" ? "Connecting…" : live.voiceFull ? "Voice is full" : "Join voice"}
        {live.voice === "off" && live.inCall > 0 ? (
          <>
            <span className="ud-livebar__count" aria-hidden="true">
              {live.inCall}
            </span>
            <span className="ud-visually-hidden">, {talking}</span>
          </>
        ) : null}
      </TextButton>
    );

  let present = null;
  if (!presenter) {
    present = compact ? (
      <IconButton
        label="Present"
        title="Present: everyone here follows your view"
        onClick={controls.startPresenting}
      >
        <IconPresentation {...ICON} />
      </IconButton>
    ) : (
      <TextButton
        icon={<IconPresentation {...ICON} />}
        title="Everyone here follows your view"
        onClick={controls.startPresenting}
      >
        Present
      </TextButton>
    );
  } else if (presenter.isMe) {
    const following = live.followers === 1 ? "1 following" : `${live.followers} following`;
    present = compact ? (
      <IconButton
        label={`Stop presenting (${following})`}
        aria-pressed
        className="ud-livebar__presenting"
        onClick={controls.stopPresenting}
      >
        <IconPresentationOff {...ICON} />
      </IconButton>
    ) : (
      <>
        <TextButton icon={<IconPresentationOff {...ICON} />} aria-pressed onClick={controls.stopPresenting}>
          Stop presenting
        </TextButton>
        <span className="ud-livebar__note" role="status">
          {following}
        </span>
      </>
    );
  } else if (!live.following) {
    present = compact ? (
      <IconButton label={`Follow ${presenter.name}`} onClick={controls.followPresenter}>
        <IconEye {...ICON} />
      </IconButton>
    ) : (
      <TextButton
        icon={<IconEye {...ICON} />}
        title={`Go back to ${presenter.name}'s view`}
        onClick={controls.followPresenter}
      >
        Follow <span className="ud-livebar__name">{presenter.name}</span>
      </TextButton>
    );
  } else if (!compact) {
    present = (
      <span className="ud-livebar__note" role="status">
        <IconPresentation {...ICON} aria-hidden="true" />
        <span>
          <span className="ud-livebar__name">{presenter.name}</span> is presenting
        </span>
      </span>
    );
  }

  let share = null;
  if (live.screen !== "off") {
    const watching = live.watchers === 1 ? "1 watching" : `${live.watchers} watching`;
    const label = live.screen === "starting" ? "Picking a screen…" : "Stop sharing";
    share = compact ? (
      <IconButton
        label={live.screen === "starting" ? label : `${label} (${watching})`}
        aria-pressed={live.screen === "sharing"}
        className="ud-livebar__presenting"
        disabled={live.screen === "starting"}
        onClick={controls.stopScreenShare}
      >
        <IconScreenShareOff {...ICON} />
      </IconButton>
    ) : (
      <>
        <TextButton
          icon={<IconScreenShareOff {...ICON} />}
          aria-pressed={live.screen === "sharing"}
          disabled={live.screen === "starting"}
          onClick={controls.stopScreenShare}
        >
          {label}
        </TextButton>
        {live.screen === "sharing" ? (
          <span className="ud-livebar__note" role="status">
            {watching}
          </span>
        ) : null}
      </>
    );
  } else if (!sharer && live.canShareScreen) {
    share = compact ? (
      <IconButton label="Share screen" onClick={startScreenShare}>
        <IconScreenShare {...ICON} />
      </IconButton>
    ) : (
      <TextButton
        icon={<IconScreenShare {...ICON} />}
        title="Show everyone here a screen, window or tab"
        onClick={startScreenShare}
      >
        Share screen
      </TextButton>
    );
  }

  return (
    <div
      className={["ud-livebar", "ud-sketch", compact ? "ud-livebar--compact" : ""].filter(Boolean).join(" ")}
      role="toolbar"
      aria-label="Voice and sharing"
      data-presenting={presenter?.isMe || live.screen === "sharing" || undefined}
    >
      <SketchArt seed={hashSeed("livebar")} shape="rect" fillStyle="solid" shadow strokeWidth={1.5} />
      {voice}
      {[present, share].map((part, i) =>
        part ? (
          <span key={i} className="ud-livebar__group">
            <span className="ud-livebar__divider" aria-hidden="true" />
            {part}
          </span>
        ) : null,
      )}
    </div>
  );
}
