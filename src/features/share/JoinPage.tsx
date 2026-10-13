import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { TornPaperDoodle } from "../../assets/illustrations";
import { SketchButton, SketchLinkButton } from "../../components/sketch";
import { FullPageMessage } from "../../components/ui/FullPageMessage";
import { Splash } from "../../components/ui/Splash";
import { SHARE_TOKEN_RE } from "../../lib/schemas";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { joinBoard } from "./collab.api";

type Failure = "gone" | "full" | "error";

/**
 * /join/:token (COLLAB-1): behind sign-in, so a signed-out visitor logs in and
 * comes back here. Joining makes them an editor and opens the board.
 */
export default function JoinPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const valid = SHARE_TOKEN_RE.test(token);
  const [result, setResult] = useState<{ key: string; failure: Failure } | null>(null);
  const key = `${token}:${attempt}`;

  useEffect(() => {
    if (!SHARE_TOKEN_RE.test(token)) return;
    let cancelled = false;
    joinBoard(token).then(
      (joined) => {
        if (cancelled) return;
        if (joined.kind === "joined") navigate(`/b/${joined.boardId}`, { replace: true });
        else setResult({ key, failure: joined.kind });
      },
      () => {
        if (!cancelled) setResult({ key, failure: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, key, navigate]);

  const failure: Failure | null = !valid ? "gone" : result?.key === key ? result.failure : null;
  useDocumentTitle(failure === "gone" ? "Link erased" : "Joining board");

  if (!failure) return <Splash label="Joining the board…" />;

  if (failure === "error") {
    return (
      <FullPageMessage
        doodle={<TornPaperDoodle width={220} />}
        title="Something smudged."
        actions={
          <>
            <SketchButton variant="primary" onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </SketchButton>
            <SketchLinkButton to="/boards">Back to boards</SketchLinkButton>
          </>
        }
      >
        Hmm, we couldn&apos;t open this edit link. Check your connection and try again.
      </FullPageMessage>
    );
  }

  return (
    <FullPageMessage
      doodle={<TornPaperDoodle width={220} />}
      title={failure === "full" ? "This board is full." : "This link has been erased."}
      actions={<SketchLinkButton to="/boards">Back to your boards</SketchLinkButton>}
    >
      {failure === "full"
        ? "It already has as many editors as it can take. Ask its owner to make room."
        : "The owner may have turned it off or made a new one. Ask them for the current link."}
    </FullPageMessage>
  );
}
