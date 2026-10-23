import "@excalidraw/excalidraw/index.css";
import "../../styles/excalidraw-overrides.css";

import {
  Excalidraw,
  Footer,
  MIME_TYPES,
  MainMenu,
  WelcomeScreen,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  LibraryItem,
  UIAppState,
  UIOptions,
} from "@excalidraw/excalidraw/types";
import {
  IconArrowLeft,
  IconDeviceFloppy,
  IconDownload,
  IconMessageOff,
  IconMessagePlus,
  IconPencil,
  IconShare,
  IconSitemap,
  IconTable,
} from "@tabler/icons-react";
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
import { createPortal } from "react-dom";
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
import { useProfile } from "../auth/profile";
import { renameBoard } from "../boards/boards.api";
import { boardsKey } from "../boards/boards.queries";
import { ShareDialog } from "../share/ShareDialog";
import { BoardTitle } from "./BoardTitle";
import { LiveBar } from "./collab/LiveBar";
import {
  addReply,
  deleteComment,
  deleteThread,
  fetchComments,
  setResolved,
  startThread,
} from "./comments/comments.api";
import { CommentLayer } from "./comments/CommentLayer";
import { CommentsController } from "./comments/CommentsController";
import { CommentToolbarButtons } from "./comments/CommentToolbarButtons";
import { ScreenView } from "./collab/ScreenView";
import { EMBED_ALLOW_LIST, HAND_DRAWN_DEFAULTS } from "./constants";
import { loadBoardFiles } from "./editor.api";
import { RecoveryDialog, RenameDialog } from "./EditorDialogs";
import { FlowController } from "./flow/FlowController";
import { FlowOverlay } from "./flow/FlowOverlay";
import { EditorSession, prefsKey } from "./EditorSession";
import { SaveStatusPill } from "./SaveStatusPill";
import { registerFlush } from "./saveRegistry";
import { TableController } from "./table/controller";
import { InsertTableDialog } from "./table/InsertTableDialog";
import { paperColor, type TableSetup } from "./table/options";
import { TableBar } from "./table/TableBar";
import { TableToolbarButtons } from "./table/TableToolbar";
import { useToolbarSlot } from "./table/useToolbarSlot";
import { selectionForTemplate } from "../library/clone";
import { LibrarySync } from "../library/librarySync";
import { insertSaved, insertTemplate } from "./templates/insertTemplate";
import type { Template } from "./templates/templates";
import { SaveTemplateDialog, TemplatesDialog } from "./templates/TemplatesDialog";
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
  /** Null for editors: only the owner renames (COLLAB-1). */
  rename: ((title: string) => void) | null;
  openShare: () => void;
  /** The editor container: phones show the save status here, outside the toolbar row. */
  host: HTMLElement | null;
}

const EditorUiContext = createContext<EditorUi | null>(null);

function EditorStatus({ iconOnly }: { iconOnly: boolean }) {
  const ui = useContext(EditorUiContext)!;
  const status = useSyncExternalStore(ui.session.subscribe, ui.session.getState);
  return (
    <SaveStatusPill
      status={status.status}
      nonce={status.nonce}
      savedAt={status.savedAt}
      errorReason={status.errorReason}
      iconOnly={iconOnly}
      backupAvailable={ui.cacheAvailable}
      onRetry={ui.session.retry}
    />
  );
}

/** Main menu: show or hide comments (CMT-1); phones have no room for it in the toolbar. */
function CommentsMenuItem({ controller }: { controller: CommentsController }) {
  const { hidden } = useSyncExternalStore(controller.subscribe, controller.getState);
  return (
    <MainMenu.Item icon={<IconMessageOff size={16} stroke={1.75} />} onSelect={controller.toggleHidden}>
      {hidden ? "Show comments" : "Hide comments"}
    </MainMenu.Item>
  );
}

/** renderTopRightUI content (VISUAL_DESIGN.md §6.3): title, status pill, Share, avatar. */
function EditorTopRight({ isMobile, sidebarOpen }: { isMobile: boolean; sidebarOpen: boolean }) {
  const ui = useContext(EditorUiContext)!;
  const wide = useMediaQuery("(min-width: 1024px)");
  if (isMobile) {
    // Phones (§11): Excalidraw puts this slot in the toolbar row, which has no
    // room to spare. The status floats under the toolbar instead, with voice
    // and presenting opposite it; Share and "Back to boards" are in the main menu.
    return ui.host
      ? createPortal(
          <>
            <div className="ud-slot ud-mobile-status">
              <EditorStatus iconOnly />
            </div>
            <div className="ud-slot ud-mobile-live">
              <LiveBar controls={ui.session} compact />
            </div>
          </>,
          ui.host,
        )
      : null;
  }
  return (
    <div className="ud-slot ud-topright">
      {/* A docked sidebar (library, search) leaves no room for the title next to the toolbar. */}
      {wide && !sidebarOpen ? <BoardTitle title={ui.title} onRename={ui.rename ?? undefined} /> : null}
      <EditorStatus iconOnly={false} />
      <SketchButton size="sm" icon={<IconShare size={18} stroke={1.75} />} onClick={ui.openShare}>
        Share
      </SketchButton>
      <AvatarMenu size={28} />
    </div>
  );
}

// --- The editor ----------------------------------------------------------------

function BoardEditor({ data, onGone }: { data: ReadyBoard; onGone: () => void }) {
  const user = useUser();
  const profile = useProfile();
  const isOwner = data.board.owner_id === user.id;
  const [peers, setPeers] = useState(0);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { setting, resolved, setTheme, applyResolvedTheme } = useTheme();
  const [initialTheme] = useState(resolved);

  const boardId = data.board.id;
  const [title, setTitle] = useState(data.board.title);
  const [shareOpen, setShareOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  /** Shapes being saved as a template (EDIT-8), while the name dialog is open. */
  const [saving, setSaving] = useState<ReturnType<typeof selectionForTemplate> | null>(null);
  const [canSaveSelection, setCanSaveSelection] = useState(false);
  // My library, synced to my account (LIB-1); my saved templates live in it.
  const [library] = useState(
    () =>
      new LibrarySync(user.id, undefined, () =>
        toast({ message: "Your templates didn't save. We'll try again when you're back online." }),
      ),
  );
  useEffect(() => library.start(), [library]);
  const libraryItems = useMemo(() => library.load(), [library]);
  const mine = useSyncExternalStore(library.subscribe, library.getItems);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
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
        lastSavedAt: Date.parse(data.board.updated_at) || null,
        baselineFingerprint: data.baselineFingerprint,
        serverElements: data.serverElements,
        serverAppState: data.board.app_state,
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
      scrollToContent: !data.viewport && data.elements.some((el) => !el.isDeleted),
      libraryItems,
    }),
    [data, initialAppState, libraryItems],
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
    session.resume();
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

  // Live collaboration (COLLAB-2…4): join the board's channel once Excalidraw is ready.
  const identity = useMemo(
    () => ({
      userId: user.id,
      name: profile?.displayName ?? user.email?.split("@")[0] ?? "Someone",
      avatarUrl: profile?.avatarUrl ?? null,
    }),
    [user.id, user.email, profile?.displayName, profile?.avatarUrl],
  );
  const identityRef = useRef(identity);
  useEffect(() => {
    identityRef.current = identity;
    session.setIdentity(identity);
  }, [session, identity]);
  useEffect(() => {
    if (!api) return;
    return session.startCollab(api, { identity: identityRef.current, onPeersChange: setPeers });
  }, [api, session]);

  // Tables (EDIT-7): ticking, resizing, the table tool, paste into cells and the table bar.
  const [tables] = useState(() => new TableController());
  useEffect(() => {
    if (!api || !host) return;
    return tables.attach(api, host);
  }, [api, host, tables]);
  const { editable } = useSyncExternalStore(tables.subscribe, tables.getState);
  // Flowcharts (EDIT-8): "+" buttons add the next step; swimlanes get a lane bar.
  const [flows] = useState(() => new FlowController());
  useEffect(() => {
    if (!api || !host) return;
    return flows.attach(api, host);
  }, [api, host, flows]);
  // Comments (CMT-1): markers on the canvas, the comment tool, and live updates from collaborators.
  const [comments] = useState(
    () =>
      new CommentsController({
        userId: user.id,
        api: {
          fetch: () => fetchComments(boardId),
          start: (anchor, body) => startThread(boardId, anchor, body),
          reply: (threadId, body) => addReply(boardId, threadId, body),
          resolve: (threadId, resolved) => setResolved(threadId, resolved ? user.id : null),
          deleteComment,
          deleteThread,
        },
        announce: session.announceComments,
        notify: (message, action) => toast({ message, action, duration: action ? 6000 : undefined }),
      }),
  );
  useEffect(() => session.onRemoteComments(comments.reload), [session, comments]);
  useEffect(() => {
    if (!api || !host) return;
    return comments.attach(api, host);
  }, [api, host, comments]);
  // Table, flowchart and comment tools sit in Excalidraw's toolbar; the footer has them if it can't be found.
  const toolbar = useToolbarSlot(host);
  const footerTools = toolbar.missing && editable;

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

  const renameBoardTitle = useCallback(
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
  const rename = isOwner ? renameBoardTitle : null;

  const backToBoards = useCallback(() => navigate("/boards"), [navigate]);

  const inViewMode = useCallback(() => {
    if (!api?.getAppState().viewModeEnabled) return false;
    toast({ message: "Turn off view mode to add to the board." });
    return true;
  }, [api, toast]);
  const openTableDialog = useCallback(() => {
    if (!inViewMode()) setTableOpen(true);
  }, [inViewMode]);
  const openTemplates = useCallback(() => {
    if (inViewMode()) return;
    setCanSaveSelection(!!api && Object.keys(api.getAppState().selectedElementIds).length > 0);
    setTemplatesOpen(true);
  }, [api, inViewMode]);
  /** Main menu → "Save as template…", or the button in the Templates dialog. */
  const startSaving = useCallback(() => {
    if (!api || inViewMode()) return;
    const picked = selectionForTemplate(api.getSceneElements(), api.getAppState().selectedElementIds);
    if (picked.elements.length === 0) {
      toast({
        message: picked.skippedImages
          ? "Images can't go into templates. Select some shapes too."
          : "Select the shapes you want to keep first.",
      });
      return;
    }
    setTemplatesOpen(false);
    setSaving(picked);
  }, [api, inViewMode, toast]);
  const saveTemplate = useCallback(
    (name: string) => {
      if (!api || !saving) return;
      const item: LibraryItem = {
        id: crypto.randomUUID(),
        status: "unpublished",
        elements: saving.elements,
        created: Date.now(),
        name,
      };
      void api.updateLibrary({ libraryItems: [item], merge: true });
      toast({ message: `Saved “${name}” to your templates.` });
    },
    [api, saving, toast],
  );
  const insertMine = useCallback(
    (item: LibraryItem) => {
      if (api) insertSaved(api, item);
    },
    [api],
  );
  const removeMine = useCallback(
    (item: LibraryItem) => {
      if (!api) return;
      const before = library.getItems();
      void api.updateLibrary({ libraryItems: before.filter((i) => i.id !== item.id), merge: false });
      toast({
        message: `Removed “${item.name || "Untitled template"}”.`,
        action: {
          label: "Undo",
          onClick: () => void api.updateLibrary({ libraryItems: before, merge: false }),
        },
      });
    },
    [api, library, toast],
  );
  const addTable = useCallback((setup: TableSetup) => tables.insert(setup), [tables]);
  const addTemplate = useCallback(
    (template: Template) => {
      if (api) insertTemplate(api, template);
    },
    [api],
  );

  const saveToFile = useCallback(() => {
    if (!api) return;
    const json = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local");
    downloadBlob(new Blob([json], { type: MIME_TYPES.excalidraw }), `${fileNameFor(title)}.excalidraw`);
  }, [api, title]);

  const renderTopRightUI = useCallback(
    (isMobile: boolean, appState: UIAppState) => (
      <EditorTopRight isMobile={isMobile} sidebarOpen={!!appState.openSidebar} />
    ),
    [],
  );

  const ui = useMemo<EditorUi>(
    () => ({
      session,
      title,
      cacheAvailable: data.cacheAvailable,
      rename,
      openShare: () => setShareOpen(true),
      host,
    }),
    [session, title, data.cacheAvailable, rename, host],
  );

  const children = useMemo(
    () => (
      <>
        <MainMenu>
          <MainMenu.Item icon={<IconArrowLeft size={16} stroke={1.75} />} onSelect={backToBoards}>
            Back to boards
          </MainMenu.Item>
          {isOwner ? (
            <MainMenu.Item icon={<IconPencil size={16} stroke={1.75} />} onSelect={() => setRenameOpen(true)}>
              Rename…
            </MainMenu.Item>
          ) : null}
          <MainMenu.Item icon={<IconShare size={16} stroke={1.75} />} onSelect={() => setShareOpen(true)}>
            Share…
          </MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.Item icon={<IconTable size={16} stroke={1.75} />} onSelect={openTableDialog}>
            Insert table…
          </MainMenu.Item>
          <MainMenu.Item icon={<IconSitemap size={16} stroke={1.75} />} onSelect={openTemplates}>
            Templates…
          </MainMenu.Item>
          <MainMenu.Item icon={<IconDeviceFloppy size={16} stroke={1.75} />} onSelect={startSaving}>
            Save as template…
          </MainMenu.Item>
          <CommentsMenuItem controller={comments} />
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
        {/* Excalidraw shows the footer on wider screens only; phones get the live bar from the top-right slot. */}
        <Footer>
          <div className="ud-slot ud-footer">
            {footerTools ? (
              <>
                <SketchButton
                  size="sm"
                  icon={<IconTable size={18} stroke={1.75} />}
                  onClick={openTableDialog}
                >
                  Table
                </SketchButton>
                <SketchButton
                  size="sm"
                  icon={<IconSitemap size={18} stroke={1.75} />}
                  onClick={openTemplates}
                >
                  Templates
                </SketchButton>
                <SketchButton
                  size="sm"
                  icon={<IconMessagePlus size={18} stroke={1.75} />}
                  onClick={comments.activateTool}
                >
                  Comment
                </SketchButton>
              </>
            ) : null}
            <LiveBar controls={session} compact={false} />
          </div>
        </Footer>
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
    [
      backToBoards,
      saveToFile,
      setting,
      setTheme,
      isOwner,
      openTableDialog,
      openTemplates,
      startSaving,
      footerTools,
      session,
      comments,
    ],
  );

  return (
    <EditorUiContext.Provider value={ui}>
      <div className="ud-editor" ref={setHost}>
        <Excalidraw
          excalidrawAPI={onExcalidrawAPI}
          initialData={initialData}
          onChange={onChange}
          onPointerUpdate={session.handlePointer}
          isCollaborating={peers > 0}
          theme={resolved}
          name={title}
          langCode="en"
          UIOptions={UI_OPTIONS}
          validateEmbeddable={EMBED_ALLOW_LIST}
          renderTopRightUI={renderTopRightUI}
          onPaste={tables.onPaste}
          onLibraryChange={library.handleChange}
        >
          {children}
        </Excalidraw>
        <TableBar controller={tables} />
        <FlowOverlay controller={flows} />
        <ScreenView controls={session} />
        <CommentLayer controller={comments} people={{ userId: user.id, isOwner }} />
      </div>
      {toolbar.slot
        ? createPortal(
            <>
              <TableToolbarButtons controller={tables} onTemplates={openTemplates} />
              <CommentToolbarButtons controller={comments} />
            </>,
            toolbar.slot,
          )
        : null}
      {rename ? (
        <RenameDialog
          open={renameOpen}
          title={title}
          onClose={() => setRenameOpen(false)}
          onRename={rename}
        />
      ) : null}
      {tableOpen ? (
        <InsertTableDialog
          paper={api ? paperColor(api.getAppState()) : "#ffffff"}
          onClose={() => setTableOpen(false)}
          onInsert={addTable}
        />
      ) : null}
      {templatesOpen ? (
        <TemplatesDialog
          mine={mine}
          onClose={() => setTemplatesOpen(false)}
          onPick={addTemplate}
          onPickMine={insertMine}
          onRemoveMine={removeMine}
          onSaveSelection={canSaveSelection ? startSaving : undefined}
        />
      ) : null}
      {saving ? (
        <SaveTemplateDialog
          count={saving.elements.filter((el) => el.type !== "text" || !el.containerId).length}
          skippedImages={saving.skippedImages}
          onClose={() => setSaving(null)}
          onSave={saveTemplate}
        />
      ) : null}
      {shareOpen ? (
        <ShareDialog
          open
          onClose={() => setShareOpen(false)}
          boardId={boardId}
          title={title}
          isOwner={isOwner}
          onLeft={() => {
            setShareOpen(false);
            refreshDashboard();
            toast({ message: `You left "${title}".` });
            navigate("/boards");
          }}
        />
      ) : null}
    </EditorUiContext.Provider>
  );
}

// --- Route component -----------------------------------------------------------------

/** "This board is in the trash" with Restore (DASH-4). */
function TrashedBoard({ title, onRestore }: { title: string; onRestore: (() => Promise<void>) | null }) {
  useDocumentTitle(title);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <FullPageMessage
      doodle={<EraserDoodle width={200} />}
      title="This board is in the trash."
      actions={
        <>
          {onRestore ? (
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
          ) : null}
          <SketchLinkButton to="/boards">Back to boards</SketchLinkButton>
        </>
      }
    >
      <p>
        &ldquo;{title}&rdquo; was moved to the trash.{" "}
        {onRestore ? "Restore it to keep drawing." : "Only its owner can restore it."}
      </p>
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
      return (
        <TrashedBoard
          title={state.board.title}
          onRestore={state.board.owner_id === user.id ? restoreFromTrash : null}
        />
      );
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
