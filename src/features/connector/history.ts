import { newElementWith, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { finish, type Change } from "./place";
import { ConnectorError } from "./types";
import { describeUnits } from "./units";

/**
 * Deleting and putting a board back (AI-5). Deletions are tombstones and
 * restores outrank every current version, so open editors merging the change
 * (reconcileElements) end up with exactly the snapshot.
 */

type El = ExcalidrawElement;

/** Tombstones each unit's elements; a frame takes what's in it along, as in Excalidraw. */
export function deleteUnits(elements: readonly El[], unitIds: string[]): Change {
  const units = new Map(describeUnits(elements).map((u) => [u.id, u]));
  const doomed = new Set<string>();
  for (const id of unitIds) {
    const unit = units.get(id);
    if (!unit)
      throw new ConnectorError(
        `There's no unit "${id}" on the board. Read the board again; it may have changed.`,
      );
    if (unit.locked) throw new ConnectorError(`"${id}" is locked, so it can't be deleted from here.`);
    unit.elementIds.forEach((el) => doomed.add(el));
    if (unit.kind === "frame") {
      for (const el of elements) if (!el.isDeleted && el.frameId === unit.elementIds[0]) doomed.add(el.id);
    }
  }
  return finish(
    elements,
    elements.filter((el) => doomed.has(el.id)).map((el) => newElementWith(el, { isDeleted: true })),
    [],
  );
}

function nonce(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! >>> 1;
}

/** The snapshot again: its elements above every current version, and anything newer deleted. */
export function restoreSnapshot(current: readonly El[], snapshot: readonly El[]): Change {
  const now = new Map(current.map((el) => [el.id, el]));
  const inSnapshot = new Set(snapshot.map((el) => el.id));
  const updated = Date.now();
  const restored = snapshot.map((el): El => ({
    ...el,
    version: Math.max(now.get(el.id)?.version ?? 0, el.version) + 1,
    versionNonce: nonce(),
    updated,
  }));
  const newer = current
    .filter((el) => !inSnapshot.has(el.id) && !el.isDeleted)
    .map((el) => newElementWith(el, { isDeleted: true }));
  const untouched = current.filter((el) => !inSnapshot.has(el.id) && el.isDeleted);

  // Snapshot order first, so z-order and indices come back as they were.
  const scene = restoreElements([...restored, ...newer, ...untouched], null, { repairBindings: true });
  const changedIds = new Set([...restored, ...newer].map((el) => el.id));
  return {
    elements: scene,
    changed: scene.filter((el) => changedIds.has(el.id)),
    createdIds: restored.filter((el) => !now.has(el.id)).map((el) => el.id),
  };
}
