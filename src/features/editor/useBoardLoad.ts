import { hashElementsVersion, restoreAppState } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useCallback, useEffect, useState } from "react";
import { cacheKeys, isCacheAvailable, readCache, removeCache } from "../../lib/localCache";
import {
  localBackupSchema,
  prefsSchema,
  viewportSchema,
  type LocalBackup,
  type Prefs,
  type Viewport,
} from "../../lib/schemas";
import { restoreBoard } from "../boards/boards.api";
import {
  BoardDataError,
  fetchBoard,
  fetchBoardFiles,
  isBoardId,
  type BoardFileRow,
  type BoardRow,
} from "./editor.api";
import { pickDbAppState, restoreScene, sceneFingerprint, type DbAppState } from "./serialize";

export interface ReadyBoard {
  board: BoardRow;
  fileRows: BoardFileRow[];
  elements: readonly ExcalidrawElement[];
  dbAppState: DbAppState;
  viewport: Viewport | undefined;
  prefs: Prefs | undefined;
  cacheAvailable: boolean;
  /** Fingerprint of the server scene; null when restored local changes must be saved. */
  baselineFingerprint: string | null;
}

export type BoardLoadState =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "error"; message: string }
  | { kind: "trashed"; board: BoardRow }
  | {
      kind: "recovery";
      backup: LocalBackup;
      base: Omit<ReadyBoard, "elements" | "dbAppState" | "baselineFingerprint">;
    }
  | { kind: "ready"; data: ReadyBoard };

function fingerprintFor(elements: readonly ExcalidrawElement[], dbAppState: DbAppState): string {
  // Fill appState defaults the same way Excalidraw will, so opening a board
  // doesn't look like a change.
  return sceneFingerprint(elements, pickDbAppState(restoreAppState(dbAppState, null)));
}

/**
 * Load flow for /b/:boardId (tech §7.1): board row and files in parallel,
 * the local backup check, then restore().
 */
export function useBoardLoad(boardId: string | undefined, userId: string) {
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${boardId}:${userId}:${attempt}`;
  const validId = isBoardId(boardId);
  // Results are tagged with the request they answer; anything else is "loading".
  const [result, setResult] = useState<{ key: string; state: BoardLoadState } | null>(null);

  useEffect(() => {
    if (!isBoardId(boardId)) return;
    let cancelled = false;
    const settle = (state: BoardLoadState) => {
      if (!cancelled) setResult({ key: requestKey, state });
    };

    void (async () => {
      try {
        const [board, fileRows, cacheAvailable, backup, viewport, prefs] = await Promise.all([
          fetchBoard(boardId),
          fetchBoardFiles(boardId),
          isCacheAvailable(),
          readCache(cacheKeys.board(userId, boardId), localBackupSchema),
          readCache(cacheKeys.viewport(userId, boardId), viewportSchema),
          readCache(cacheKeys.prefs(userId), prefsSchema),
        ]);
        if (!board) return settle({ kind: "notFound" });
        if (board.deleted_at) return settle({ kind: "trashed", board });

        const base = { board, fileRows, viewport, prefs, cacheAvailable };
        const serverElements = board.scene.elements as unknown as ExcalidrawElement[];

        // Offer recovery only if the local copy is newer AND actually different
        // (tech §7.1). "Newer" also holds when the backup was made on top of the
        // version the server still has: renames and thumbnails bump updated_at
        // without saving content, and client clocks can drift.
        const localIsNewer =
          !!backup &&
          (backup.localSavedAt > Date.parse(board.updated_at) || backup.serverVersion >= board.version);
        if (
          backup &&
          localIsNewer &&
          hashElementsVersion(backup.elements as unknown as ExcalidrawElement[]) !==
            hashElementsVersion(serverElements)
        ) {
          return settle({ kind: "recovery", backup, base });
        }

        const { elements, dbAppState } = restoreScene(board.scene.elements, board.app_state);
        settle({
          kind: "ready",
          data: { ...base, elements, dbAppState, baselineFingerprint: fingerprintFor(elements, dbAppState) },
        });
      } catch (e) {
        // A malformed id or a row RLS hides both read as "not found".
        const code = (e as { code?: string } | null)?.code;
        if (code === "22P02") return settle({ kind: "notFound" });
        settle({
          kind: "error",
          message: e instanceof BoardDataError ? e.message : "Hmm, we couldn't open this board.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [boardId, userId, requestKey]);

  const state: BoardLoadState = !validId
    ? { kind: "notFound" }
    : result && result.key === requestKey
      ? result.state
      : { kind: "loading" };

  const reload = useCallback(() => setAttempt((a) => a + 1), []);

  /** Recovery prompt: "Restore them" or "Discard". */
  const resolveRecovery = useCallback(
    async (restoreLocal: boolean) => {
      setResult((r) => {
        if (!r || r.state.kind !== "recovery") return r;
        const { base, backup } = r.state;
        if (restoreLocal) {
          const { elements, dbAppState } = restoreScene(backup.elements, backup.appState);
          return {
            key: r.key,
            state: { kind: "ready", data: { ...base, elements, dbAppState, baselineFingerprint: null } },
          };
        }
        const { elements, dbAppState } = restoreScene(base.board.scene.elements, base.board.app_state);
        return {
          key: r.key,
          state: {
            kind: "ready",
            data: {
              ...base,
              elements,
              dbAppState,
              baselineFingerprint: fingerprintFor(elements, dbAppState),
            },
          },
        };
      });
      if (!restoreLocal && boardId) await removeCache(cacheKeys.board(userId, boardId));
    },
    [boardId, userId],
  );

  /** "This board is in the trash" → Restore (DASH-4). */
  const restoreFromTrash = useCallback(async () => {
    if (!boardId) return;
    await restoreBoard(boardId);
    reload();
  }, [boardId, reload]);

  return { state, reload, resolveRecovery, restoreFromTrash };
}
