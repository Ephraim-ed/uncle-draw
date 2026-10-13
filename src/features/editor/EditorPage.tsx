import "@excalidraw/excalidraw/index.css";
import "../../styles/excalidraw-overrides.css";

import { Excalidraw, MIME_TYPES, MainMenu, WelcomeScreen, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  UIOptions,
} from "@excalidraw/excalidraw/types";
import { IconArrowLeft, IconDownload, IconPencil, IconShare } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useNavigate, useParams } from "react-router";
import { useTheme } from "../../app/theme";
import { Wordmark } from "../../brand/Wordmark";
import { SketchButton, SketchLinkButton, useToast } from "../../components/sketch";
import { AvatarMenu } from "../../components/ui/AvatarMenu";
import { FullPageMessage } from "../../components/ui/FullPageMessage";
import { Splash } from "../../components/ui/Splash";
import { EraserDoodle } from "../../assets/illustrations";
import { downloadBlob, fileNameFor } from "../../lib/download";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { NotFoundPage } from "../../pages/NotFoundPage";
import { useUser } from "../auth/AuthProvider";
import { renameBoard } from "../boards/boards.api";
import { boardsKey } from "../boards/boards.queries";
import { ShareDialog } from "../share/ShareDialog";
import { BoardTitle } from "./BoardTitle";
import { EMBED_ALLOW_LIST, HAND_DRAWN_DEFAULTS } from "./constants";
import { loadBoardFiles } from "./editor.api";
import { ConflictDialog, RecoveryDialog, RenameDialog } from "./EditorDialogs";
import { EditorSession, prefsKey } from "./EditorSession";
import { SaveStatusPill } from "./SaveStatusPill";
import { registerFlush } from "./saveRegistry";
import { useBoardLoad, type ReadyBoard } from "./useBoardLoad";

const UI_OPTIONS: Partial<UIOptions> = {
  canvasActions: {
    // Importing happens from the dashboard (IO-3); Ctrl/Cmd+S forces a cloud save.
    loadScene: false,
    saveToActiveFile: false,
    // Needed because we pass `theme`; the menu item then syncs with the app (SET-1).
    toggleTheme: true,
  },
};

const NO_IDB_NOTICE_KEY = "ud:no-idb-notice";

// --- Top-right slot -----------------------------------------------------------

interface EditorUi {
  session: EditorSession;
  title: string;
  cacheAvailable: boolean;
  rename: (title: string) => void;
  openShare: () => void;
}

const EditorUiContext = createContext<EditorUi | null>(null);

/** renderTopRightUI content (VISUAL_DESIGN.md §6.3): title, status pill, Share, avatar. */
function EditorTopRight({ isMobile }: { isMobile: boolean }) {
  const ui = useContext(EditorUiContext)!;
  const status = useSyncExternalStore(ui.session.subscribe, ui.session.getState);
  const wide = useMediaQuery("(min-width: 1024px)");
  return (
    <div className="ud-slot ud-topright">
      {wide && !isMobile ? <BoardTitle title={ui.title} onRename={ui.rename} /> : null}
      <SaveStatusPill
        status={status.status}
        nonce={status.nonce}
        errorReason={status.errorReason}
        iconOnly={isMobile}
        backupAvailable={ui.cacheAvailable}
        onRetry={ui.session.retry}
      />
      <SketchButton
        size="sm"
        icon={<IconShare size={18} stroke={1.75} />}
        onClick={ui.openShare}
        aria-label={isMobile ? "Share" : undefined}
      >
        {isMobile ? undefined : "Share"}
      </SketchButton>
      <AvatarMenu size={28} />
    </div>
  );
}

/** Opens the conflict dialog whenever autosave reports a conflict (SAVE-4). */
function ConflictGate({ session }: { session: EditorSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch {
      toast({ message: "Hmm, that didn't work. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConflictDialog
      open={state.status === "conflict"}
      busy={busy}
      onLoadLatest={run(() => session.loadLatest())}
      onKeepMine={run(() => session.keepMine())}
    />
  );
}

// --- The editor ----------------------------------------------------------------

function BoardEditor({ data, onGone }: { data: ReadyBoard; onGone: () => void }) {
  const user = useUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { setting, resolved, setTheme, applyResolvedTheme } = useTheme();
  const [initialTheme] = useState(resolved);

  const boardId = data.board.id;
  const [title, setTitle] = useState(data.board.title);
  const [shareOpen, setShareOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  useDocumentTitle(title);

  const refreshDashboard = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: boardsKey(user.id) }),
    [queryClient, user.id],
  );

  const initialAppState = useMemo(
    () => ({
      ...HAND_DRAWN_DEFAULTS,
      ...data.prefs,
      ...data.dbAppState,
      ...(data.viewport
        ? {
            scrollX: data.viewport.scrollX,
            scrollY: data.viewport.scrollY,
            zoom: { value: data.viewport.zoom },
          }
        : {}),
      theme: initialTheme,
    }),
    [data, initialTheme],
  );

  const [session] = useState(
    () =>
      new EditorSession({
        userId: user.id,
        boardId,
        initialVersion: data.board.version,
        baselineFingerprint: data.baselineFingerprint,
        knownFileIds: data.fileRows.map((r) => r.file_id),
        initialTheme,
        initialPrefsKey: prefsKey(initialAppState as Partial<AppState>),
        onThemeChange: applyResolvedTheme,
        notify: (message, opts) => toast({ message, ...opts }),
        onServerChange: refreshDashboard,
        onGone,
      }),
  );

  const initialData = useMemo<ExcalidrawInitialDataState>(
    () => ({
      elements: data.elements as ExcalidrawElement[],
      appState: initialAppState as ExcalidrawInitialDataState["appState"],
      scrollToContent: !data.viewport && data.elements.length > 0,
    }),
    [data, initialAppState],
  );

  // Sign-out flushes every open editor (AUTH-3).
  useEffect(() => registerFlush(() => session.flush()), [session]);

  // Leaving the editor: capture the scene before Excalidraw unmounts (layout
  // cleanups run before the child's componentWillUnmount), then save and
  // refresh the thumbnail. Deferred so a StrictMode remount can cancel it.
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLayoutEffect(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
    return () => {
      const finish = session.beginLeave();
      leaveTimer.current = setTimeout(() => void finish().then(refreshDashboard), 0);
    };
  }, [session, refreshDashboard]);

  // Flush triggers and offline handling (tech §7.2).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void session.flush();
    };
    const onPageHide = () => void session.flush();
    const onOnline = () => session.handleOnline();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (session.shouldBlockUnload()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        void session.forceSave();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [session]);

  // Images: signed URLs → data URLs → addFiles. Placeholders show until then.
  useEffect(() => {
    if (!api || data.fileRows.length === 0) return;
    let cancelled = false;
    void loadBoardFiles(data.fileRows).then((files) => {
      if (!cancelled && files.length > 0) api.addFiles(files);
    });
    return () => {
      cancelled = true;
    };
  }, [api, data.fileRows]);

  // One-time notice when IndexedDB is unavailable (SAVE-3).
  useEffect(() => {
    if (data.cacheAvailable) return;
    try {
      if (sessionStorage.getItem(NO_IDB_NOTICE_KEY)) return;
      sessionStorage.setItem(NO_IDB_NOTICE_KEY, "1");
    } catch {
      // ignore
    }
    toast({
      message: "Offline backup isn't available in this browser, so changes only save while you're online.",
      duration: 7000,
    });
  }, [data.cacheAvailable, toast]);

  const onExcalidrawAPI = useCallback(
    (instance: ExcalidrawImperativeAPI) => {
      session.attach(instance);
      setApi(instance);
    },
    [session],
  );

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) =>
      session.handleChange(elements, appState, files),
    [session],
  );

  const rename = useCallback(
    (next: string) => {
      const previous = title;
      setTitle(next);
      renameBoard(boardId, next).then(refreshDashboard, () => {
        setTitle(previous);
        toast({ message: "Hmm, that rename didn't save. Try again." });
      });
    },
    [boardId, title, refreshDashboard, toast],
  );

  const backToBoards = useCallback(() => navigate("/boards"), [navigate]);

  const saveToFile = useCallback(() => {
    if (!api) return;
    const json = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local");
    downloadBlob(new Blob([json], { type: MIME_TYPES.excalidraw }), `${fileNameFor(title)}.excalidraw`);
  }, [api, title]);

  const renderTopRightUI = useCallback((isMobile: boolean) => <EditorTopRight isMobile={isMobile} />, []);

  const ui = useMemo<EditorUi>(
    () => ({
      session,
      title,
      cacheAvailable: data.cacheAvailable,
      rename,
      openShare: () => setShareOpen(true),
    }),
    [session, title, data.cacheAvailable, rename],
  );

  const children = useMemo(
    () => (
      <>
        <MainMenu>
          <MainMenu.Item icon={<IconArrowLeft size={16} stroke={1.75} />} onSelect={backToBoards}>
            Back to boards
          </MainMenu.Item>
          <MainMenu.Item icon={<IconPencil size={16} stroke={1.75} />} onSelect={() => setRenameOpen(true)}>
            Rename…
          </MainMenu.Item>
          <MainMenu.Item icon={<IconShare size={16} stroke={1.75} />} onSelect={() => setShareOpen(true)}>
            Share…
          </MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Item icon={<IconDownload size={16} stroke={1.75} />} onSelect={saveToFile}>
            Save to file
          </MainMenu.Item>
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme allowSystemTheme theme={setting} onSelect={setTheme} />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.ClearCanvas />
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Hints.MenuHint />
          <WelcomeScreen.Hints.ToolbarHint />
          <WelcomeScreen.Hints.HelpHint />
          <WelcomeScreen.Center>
            <WelcomeScreen.Center.Logo>
              <Wordmark size="display" />
            </WelcomeScreen.Center.Logo>
            <WelcomeScreen.Center.Heading>
              Start sketching. Uncle Draw saves as you go.
            </WelcomeScreen.Center.Heading>
            <WelcomeScreen.Center.Menu>
              <WelcomeScreen.Center.MenuItem
                onSelect={backToBoards}
                icon={<IconArrowLeft size={16} stroke={1.75} />}
              >
                Back to boards
              </WelcomeScreen.Center.MenuItem>
              <WelcomeScreen.Center.MenuItemHelp />
            </WelcomeScreen.Center.Menu>
          </WelcomeScreen.Center>
        </WelcomeScreen>
      </>
    ),
    [backToBoards, saveToFile, setting, setTheme],
  );

  return (
    <EditorUiContext.Provider value={ui}>
      <div className="ud-editor">
        <Excalidraw
          excalidrawAPI={onExcalidrawAPI}
          initialData={initialData}
          onChange={onChange}
          theme={resolved}
          name={title}
          langCode="en"
          UIOptions={UI_OPTIONS}
          validateEmbeddable={EMBED_ALLOW_LIST}
          renderTopRightUI={renderTopRightUI}
        >
          {children}
        </Excalidraw>
      </div>
      <ConflictGate session={session} />
      <RenameDialog open={renameOpen} title={title} onClose={() => setRenameOpen(false)} onRename={rename} />
      {shareOpen ? (
        <ShareDialog open onClose={() => setShareOpen(false)} boardId={boardId} title={title} />
      ) : null}
    </EditorUiContext.Provider>
  );
}

// --- Route component -----------------------------------------------------------------

/** "This board is in the trash" with Restore (DASH-4). */
function TrashedBoard({ title, onRestore }: { title: string; onRestore: () => Promise<void> }) {
  useDocumentTitle(title);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <FullPageMessage
      doodle={<EraserDoodle width={200} />}
      title="This board is in the trash."
      actions={
        <>
          <SketchButton
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setFailed(false);
              try {
                await onRestore();
              } catch {
                setFailed(true);
                setBusy(false);
              }
            }}
          >
            Restore
          </SketchButton>
          <SketchLinkButton to="/boards">Back to boards</SketchLinkButton>
        </>
      }
    >
      <p>&ldquo;{title}&rdquo; was moved to the trash. Restore it to keep drawing.</p>
      {failed ? (
        <p className="mt-2 text-danger" role="alert">
          Hmm, that didn&apos;t work. Try again.
        </p>
      ) : null}
    </FullPageMessage>
  );
}

/** /b/:boardId (lazy). */
export default function EditorPage() {
  const { boardId } = useParams();
  const user = useUser();
  const { state, reload, resolveRecovery, restoreFromTrash } = useBoardLoad(boardId, user.id);

  switch (state.kind) {
    case "loading":
      return <Splash label="Opening your board…" />;
    case "notFound":
      return <NotFoundPage />;
    case "error":
      return (
        <FullPageMessage
          doodle={<EraserDoodle width={200} />}
          title="Something smudged."
          actions={
            <>
              <SketchButton variant="primary" onClick={reload}>
                Try again
              </SketchButton>
              <SketchLinkButton to="/boards">Back to boards</SketchLinkButton>
            </>
          }
        >
          {state.message}
        </FullPageMessage>
      );
    case "trashed":
      return <TrashedBoard title={state.board.title} onRestore={restoreFromTrash} />;
    case "recovery":
      return (
        <>
          <Splash label="Opening your board…" />
          <RecoveryDialog
            savedAt={state.backup.localSavedAt}
            onRestore={() => void resolveRecovery(true)}
            onDiscard={() => void resolveRecovery(false)}
          />
        </>
      );
    case "ready":
      return <BoardEditor key={state.data.board.id} data={state.data} onGone={reload} />;
  }
}
