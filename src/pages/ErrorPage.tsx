import { isRouteErrorResponse, useRouteError } from "react-router";
import { EraserDoodle } from "../assets/illustrations";
import { SketchButton, SketchLinkButton } from "../components/sketch";
import { FullPageMessage } from "../components/ui/FullPageMessage";
import { NotFoundPage } from "./NotFoundPage";

/** Generic error boundary: "Something smudged." (VISUAL_DESIGN.md §6.6). */
export function ErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  if (import.meta.env.DEV) console.error(error);
  return (
    <FullPageMessage
      doodle={<EraserDoodle width={220} />}
      title="Something smudged."
      actions={
        <>
          <SketchButton variant="primary" onClick={() => window.location.reload()}>
            Reload
          </SketchButton>
          <SketchLinkButton to="/boards" reloadDocument>
            Back to boards
          </SketchLinkButton>
        </>
      }
    >
      Something went wrong on our side. Your boards are safe.
    </FullPageMessage>
  );
}
