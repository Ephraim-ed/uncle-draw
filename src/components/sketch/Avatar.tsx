import { useState } from "react";
import { SketchArt } from "./SketchArt";
import { hashSeed } from "./seed";

export interface AvatarProps {
  name: string;
  url?: string | null;
  size?: number;
  seedKey?: string;
}

/** GitHub avatar in a rough circle; falls back to the initial in Excalifont (§5.3). */
export function Avatar({ name, url, size = 32, seedKey }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const showImage = !!url && !broken;
  return (
    <span
      className="ud-avatar ud-sketch"
      style={{ width: size, height: size, fontSize: Math.max(18, Math.round(size * 0.56)) }}
      aria-hidden="true"
    >
      <SketchArt
        seed={hashSeed(seedKey ?? `avatar:${name}`)}
        shape="circle"
        fillStyle={showImage ? "none" : "solid"}
      />
      {showImage ? (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          className="ud-avatar__img"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="ud-avatar__initial">{initial}</span>
      )}
    </span>
  );
}
