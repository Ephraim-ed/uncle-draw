import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { PencilHandoffDoodle, TornPaperDoodle } from "../../assets/illustrations";
import { SketchButton, SketchLinkButton } from "../../components/sketch";
import { FullPageMessage } from "../../components/ui/FullPageMessage";
import { Splash } from "../../components/ui/Splash";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import {
  approveAuthorization,
  denyAuthorization,
  getAuthorization,
  goTo,
  type Authorization,
} from "./oauth.api";

type State =
  | { kind: "loading" }
  | { kind: "ask"; details: Extract<Authorization, { authorization_id: string }> }
  | { kind: "leaving" }
  | { kind: "failed"; reason: string };

/** What Supabase said, for the person (and for us, when they tell us). */
function reasonOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : String(e);
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

/**
 * /oauth/consent (AI-1): another app, like Claude, asks to use Uncle Draw as
 * the signed-in user. Behind sign-in, so a signed-out visitor logs in and
 * comes back here with the same authorization_id.
 */
export default function OAuthConsentPage() {
  const [params] = useSearchParams();
  const id = params.get("authorization_id") ?? "";
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useDocumentTitle("Connect an app");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getAuthorization(id).then(
      (details) => {
        if (cancelled) return;
        if ("authorization_id" in details) setState({ kind: "ask", details });
        else {
          // They said yes before: straight back to the app.
          setState({ kind: "leaving" });
          goTo(details.redirect_url);
        }
      },
      (e: unknown) => {
        if (!cancelled) setState({ kind: "failed", reason: reasonOf(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const answer = (approve: boolean) => {
    setState({ kind: "leaving" });
    (approve ? approveAuthorization(id) : denyAuthorization(id)).then(goTo, (e: unknown) =>
      setState({ kind: "failed", reason: reasonOf(e) }),
    );
  };

  if (!id) {
    return (
      <FullPageMessage
        doodle={<TornPaperDoodle width={220} />}
        title="This sign-in link isn't complete."
        actions={<SketchLinkButton to="/boards">Back to boards</SketchLinkButton>}
      >
        Start connecting again from the app that sent you here.
      </FullPageMessage>
    );
  }
  if (state.kind === "failed") {
    return (
      <FullPageMessage
        doodle={<TornPaperDoodle width={220} />}
        title="We couldn't open this sign-in request."
        actions={
          <>
            <SketchButton
              variant="primary"
              onClick={() => {
                setState({ kind: "loading" });
                setAttempt((a) => a + 1);
              }}
            >
              Try again
            </SketchButton>
            <SketchLinkButton to="/boards">Back to boards</SketchLinkButton>
          </>
        }
      >
        <p>
          It may have expired. If trying again doesn&apos;t help, start connecting again from the app that
          sent you here.
        </p>
        <p className="mt-2 text-label">Supabase said: {state.reason}</p>
      </FullPageMessage>
    );
  }
  if (state.kind === "loading") return <Splash label="Checking the request…" />;
  if (state.kind === "leaving") return <Splash label="Taking you back…" />;

  const { client, redirect_uri, user } = state.details;
  return (
    <FullPageMessage
      doodle={<PencilHandoffDoodle width={220} />}
      title={`${client.name} wants to use Uncle Draw as you`}
      actions={
        <>
          <SketchButton variant="primary" onClick={() => answer(true)}>
            Allow
          </SketchButton>
          <SketchButton onClick={() => answer(false)}>Cancel</SketchButton>
        </>
      }
    >
      <p>It can see, create and change boards you can edit.</p>
      <p className="mt-2">
        You&apos;ll go back to {hostOf(redirect_uri)} afterwards. Signed in as {user.email}.
      </p>
    </FullPageMessage>
  );
}
