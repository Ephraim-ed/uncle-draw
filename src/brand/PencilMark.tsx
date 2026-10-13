import { RoughDrawing, type DrawingItem } from "../components/sketch/RoughDrawing";
import { PENCIL_PARTS, PENCIL_ROTATION, PENCIL_SEED } from "./pencil";

const ITEMS: DrawingItem[] = PENCIL_PARTS.map((part) => ({
  shape: part.closed ? { kind: "polygon", points: part.points } : { kind: "linearPath", points: part.points },
  tone: part.tone,
  ...(part.fillTone
    ? { fillTone: part.fillTone, fillStyle: part.fillStyle ?? "hachure", hachureGap: 3 }
    : {}),
  strokeWidth: 1.6,
}));

export interface PencilMarkProps {
  size?: number;
  /** Boil while loading (§8). */
  boil?: boolean;
  title?: string;
  className?: string;
}

/** The slanted pencil mark: favicon, splash and loading states. */
export function PencilMark({ size = 32, boil, title, className }: PencilMarkProps) {
  return (
    <span className={className} style={{ display: "inline-flex", width: size, height: size }}>
      <RoughDrawing
        width={64}
        height={64}
        items={ITEMS}
        seed={PENCIL_SEED}
        boil={boil}
        title={title}
        transform={`rotate(${PENCIL_ROTATION} 32 32)`}
      />
    </span>
  );
}
