import type { ScreenMedia } from "./ScreenShare";
import type { Meter, VoiceMedia } from "./VoiceChat";

/** The microphone, WebRTC and Web Audio, for real (COLLAB-5). */
export function browserVoiceMedia(iceServers: RTCIceServer[]): VoiceMedia {
  let context: AudioContext | null = null;
  const audioContext = () => {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    return context;
  };

  return {
    getMicrophone() {
      // Missing outside secure contexts (http on another host) and in old browsers.
      if (!navigator.mediaDevices?.getUserMedia) {
        return Promise.reject(new DOMException("No microphone access here", "NotSupportedError"));
      }
      return navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    },

    createConnection: () => new RTCPeerConnection({ iceServers }),

    play(stream) {
      const audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = stream;
      let stopped = false;
      // Autoplay can be refused until the next click or key press (Safari, mostly).
      const retry = () => {
        if (!stopped) void audio.play().catch(() => undefined);
      };
      void audio.play().catch(() => {
        window.addEventListener("pointerdown", retry, { once: true, capture: true });
        window.addEventListener("keydown", retry, { once: true, capture: true });
      });
      return () => {
        stopped = true;
        window.removeEventListener("pointerdown", retry, { capture: true });
        window.removeEventListener("keydown", retry, { capture: true });
        audio.pause();
        audio.srcObject = null;
      };
    },

    meter(stream): Meter {
      const ctx = audioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048; // about 43 ms of audio per reading
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      return {
        level() {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const v of samples) sum += v * v;
          return Math.sqrt(sum / samples.length);
        },
        stop() {
          source.disconnect();
        },
      };
    },

    release() {
      void context?.close().catch(() => undefined);
      context = null;
    },
  };
}

/** Screen capture and WebRTC, for real (COLLAB-7). */
export function browserScreenMedia(iceServers: RTCIceServer[]): ScreenMedia {
  return {
    canShare:
      typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function",
    getDisplay: () =>
      navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false }),
    createConnection: () => new RTCPeerConnection({ iceServers }),
  };
}
