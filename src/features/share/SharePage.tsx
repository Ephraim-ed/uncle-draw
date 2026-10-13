import "@excalidraw/excalidraw/index.css";
import "../../styles/excalidraw-overrides.css";

import { Excalidraw, MainMenu, exportToBlob, exportToSvg, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI, UIOptions } from "@excalidraw/excalidraw/types";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { IconEye } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useTheme } from "../../app/theme";
import { EraserDoodle, TornPaperDoodle } from "../../assets/illustrations";
import { SketchArt, SketchButton, SketchLinkButton, hashSeed } from "../../components/sketch";
import { FullPageMessage } from "../../components/ui/FullPageMessage";
import { Splash } from "../../components/ui/Splash";
import { downloadBlob, fileNameFor } from "../../lib/download";
import { SHARE_TOKEN_RE, sharedBoardSchema, type SharedBoard } from "../../lib/schemas";
import { supabase } from "../../lib/supabase";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { EMBED_ALLOW_LIST } from "../editor/constants";
import { downloadFiles } from "../editor/editor.api";
import { restoreScene } from "../editor/serialize";

const SHARE_UI_OPTIONS: Partial<UIOptions> = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false,
    clearCanvas: false,
    changeViewBackgroundColor: false,
    toggleTheme: true,
  },
};

type LoadState =
  | { kind: "loading" }
  | { kind: "erased" }
  | { kind: "error" }
  | { kind: "ready"; board: SharedBoard; elements: readonly ExcalidrawElement[] };

async function fetchSharedBoard(token: string): Promise<LoadState> {
  const { data, error } = await supabase.functions.invoke("get-shared-board", { body: { token } });
  if (error) {
    if (error instanceof FunctionsHttpError && (error.context as Response | undefined)?.status === 404) {
      return { kind: "erased" };
    }
    return { kind: "error" };
  }
  const parsed = sharedBoardSchema.safeParse(data);
  if (!parsed.success) return { kind: "error" };
  const { elements } = restoreScene(parsed.data.scene.elements, parsed.data.app_state);
  return { kind: "ready", board: parsed.data, elements };
}

/** Revoked, expired, unknown or trashed: all the same page (SHARE-2). */
function LinkErased() {
  useDocumentTitle("Link erased");
  return (
    <FullPageMessage
      doodle={<TornPaperDoodle width={220} />}
      title="This link has been erased."
      actions={
        <SketchLinkButton to="/" variant="primary">
          Go to Uncle Draw
        </SketchLinkButton>
      }
    >
      Ask the person who shared it for a new link.
    </FullPageMessage>
  );
}

function SharedBoardView({
  board,
  elements,
}: {
  board: SharedBoard;
  elements: readonly ExcalidrawElement[];
}) {
  useDocumentTitle(board.title);
  const { setting, resolved, setTheme, applyResolvedTheme } = useTheme();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [initialTheme] = useState(resolved);
  const lastSeenTheme = useRef(initialTheme);

  const initialData = useMemo(
    () => ({
      elements: elements as ExcalidrawElement[],
      appState: { ...board.app_state, theme: initialTheme } as Partial<AppState>,
    }),
    [board, elements, initialTheme],
  );

  // Viewers see the whole board on any screen size: centered at 100%, or
  // zoomed out just enough when it doesn't fit.
  useEffect(() => {
    if (!api || elements.length === 0) return;
    const id = requestAnimationFrame(() => {
      const [minX, minY, maxX, maxY] = getCommonBounds(elements);
      const fits = maxX - minX <= window.innerWidth * 0.85 && maxY - minY <= window.innerHeight * 0.75;
      api.scrollToContent(
        undefined,
        fits ? { animate: false } : { fitToViewport: true, viewportZoomFactor: 0.85, animate: false },
      );
    });
    return () => cancelAnimationFrame(id);
  }, [api, elements]);

  useEffect(() => {
    if (!api || board.files.length === 0) return;
    let cancelled = false;
    void downloadFiles(board.files).then((files) => {
      if (!cancelled && files.length > 0) api.addFiles(files);
    });
    return () => {
      cancelled = true;
    };
  }, [api, board.files]);

  // Follow Excalidraw's own theme toggle (Alt+Shift+D) into the app setting.
  const onChange = useCallback(
    (_elements: readonly ExcalidrawElement[], appState: AppState) => {
      if (appState.theme !== lastSeenTheme.current) {
        lastSeenTheme.current = appState.theme;
        applyResolvedTheme(appState.theme);
      }
    },
    [applyResolvedTheme],
  );

  const download = useCallback(
    async (kind: "png" | "svg") => {
      if (!api) return;
      const opts = {
        elements: api.getSceneElements(),
        appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false },
        files: api.getFiles(),
      };
      const name = fileNameFor(board.title);
      if (kind === "png") {
        downloadBlob(await exportToBlob({ ...opts, mimeType: "image/png" }), `${name}.png`);
      } else {
        const svg = await exportToSvg(opts);
        downloadBlob(new Blob([svg.outerHTML], { type: "image/svg+xml" }), `${name}.svg`);
      }
    },
    [api, board.title],
  );

  const renderTopRightUI = useCallback(
    (isMobile: boolean) => (
      <div className="ud-slot ud-topright">
        {!isMobile ? (
          <>
            <button type="button" className="ud-textbtn" onClick={() => void download("png")}>
              Download PNG
            </button>
            <button type="button" className="ud-textbtn" onClick={() => void download("svg")}>
              Download SVG
            </button>
          </>
        ) : null}
        <Link to="/" className="ud-textbtn ud-textbtn--primary">
          Made with Uncle Draw
        </Link>
      </div>
    ),
    [download],
  );

  return (
    <div className="ud-editor">
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={onChange}
        viewModeEnabled
        theme={resolved}
        name={board.title}
        langCode="en"
        UIOptions={SHARE_UI_OPTIONS}
        validateEmbeddable={EMBED_ALLOW_LIST}
        renderTopRightUI={renderTopRightUI}
      >
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.Help />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme allowSystemTheme theme={setting} onSelect={setTheme} />
        </MainMenu>
      </Excalidraw>
      <div className="ud-share-banner ud-sketch ud-slot" role="note">
        <SketchArt
          seed={hashSeed(`banner:${board.title}`)}
          shape="rect"
          fillStyle="solid"
          stroke={false}
          shadow
        />
        <IconEye size={18} stroke={1.75} aria-hidden="true" />
        <span className="truncate">
          View only · <strong>{board.title}</strong> ·{" "}
          <Link to="/" className="ud-share-banner__link">
            Uncle Draw
          </Link>
        </span>
      </div>
    </div>
  );
}

/** /s/:token: read-only share view, no sign-in (SHARE-2; VISUAL_DESIGN.md §6.4). Lazy. */
export default function SharePage() {
  const { token } = useParams();
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${token}:${attempt}`;
  const validToken = !!token && SHARE_TOKEN_RE.test(token);
  const [result, setResult] = useState<{ key: string; state: LoadState } | null>(null);

  useEffect(() => {
    if (!token || !SHARE_TOKEN_RE.test(token)) return;
    let cancelled = false;
    fetchSharedBoard(token).then(
      (next) => !cancelled && setResult({ key: requestKey, state: next }),
      () => !cancelled && setResult({ key: requestKey, state: { kind: "error" } }),
    );
    return () => {
      cancelled = true;
    };
  }, [token, requestKey]);

  const state: LoadState = !validToken
    ? { kind: "erased" }
    : result && result.key === requestKey
      ? result.state
      : { kind: "loading" };

  switch (state.kind) {
    case "loading":
      return <Splash label="Opening the board…" />;
    case "erased":
      return <LinkErased />;
    case "error":
      return (
        <FullPageMessage
          doodle={<EraserDoodle width={200} />}
          title="Something smudged."
          actions={
            <SketchButton variant="primary" onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </SketchButton>
          }
        >
          We couldn&apos;t open this board right now.
        </FullPageMessage>
      );
    case "ready":
      return <SharedBoardView board={state.board} elements={state.elements} />;
  }
}
