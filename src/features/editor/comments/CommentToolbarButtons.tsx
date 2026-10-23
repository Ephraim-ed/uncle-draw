import { IconMessageOff, IconMessagePlus } from "@tabler/icons-react";
import { useSyncExternalStore } from "react";
import type { CommentsController } from "./CommentsController";

/**
 * The comment tool and "Hide comments" (CMT-1), in Excalidraw's own tool
 * markup so they look and behave like its tools (the toggle like its lock).
 */
export function CommentToolbarButtons({ controller }: { controller: CommentsController }) {
  const { toolActive, hidden } = useSyncExternalStore(controller.subscribe, controller.getState);
  return (
    <>
      <label
        className="ToolIcon Shape ToolIcon_size_medium"
        title="Comment — C (on the selection, or click a shape or a spot)"
      >
        <input
          className="ToolIcon_type_radio ToolIcon_size_medium"
          type="radio"
          name="ud-comment-tool"
          checked={toolActive}
          onChange={controller.activateTool}
          aria-label="Comment"
          aria-keyshortcuts="C"
          data-testid="toolbar-comment"
        />
        <div className="ToolIcon__icon">
          <IconMessagePlus stroke={1.5} />
          <span className="ToolIcon__keybinding">C</span>
        </div>
      </label>
      <label
        className="ToolIcon Shape ToolIcon_size_medium ud-toolbar-hide-comments"
        title={hidden ? "Show comments" : "Hide comments"}
      >
        <input
          className="ToolIcon_type_checkbox ToolIcon_size_medium"
          type="checkbox"
          checked={hidden}
          onChange={controller.toggleHidden}
          aria-label="Hide comments"
          data-testid="toolbar-hide-comments"
        />
        <div className="ToolIcon__icon">
          <IconMessageOff stroke={1.5} />
        </div>
      </label>
    </>
  );
}
