import { IconBrandGithub } from "@tabler/icons-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router";
import { EnvelopeDoodle, PencilHandoffDoodle } from "../../assets/illustrations";
import { Wordmark } from "../../brand/Wordmark";
import { SketchBox, SketchButton, SketchInput, hashSeed } from "../../components/sketch";
import { Splash } from "../../components/ui/Splash";
import { safeNext } from "../../lib/safeNext";
import { supabase } from "../../lib/supabase";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useAuth } from "./AuthProvider";
import { callbackUrl, lastEmail, rememberEmail, rememberNext } from "./authNext";

const COOLDOWN_MS = 60_000;
const WAIT_MESSAGE = "Please wait a minute before requesting another link.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = "form" | "sent";

function isRateLimited(error: { status?: number; code?: string } | null): boolean {
  return !!error && (error.status === 429 || error.code === "over_email_send_rate_limit");
}

/** /login: magic link + GitHub (AUTH-1, AUTH-2; VISUAL_DESIGN.md §6.1). */
export function LoginPage() {
  useDocumentTitle("Sign in");
  const { session, loading, signingOut } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const linkError = params.get("error") === "link";

  const [mode, setMode] = useState<Mode>("form");
  const [email, setEmail] = useState(() => (linkError ? lastEmail() : ""));
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const cooldownUntil = useRef(0);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "form") emailRef.current?.focus();
  }, [mode]);

  if (loading) return <Splash />;
  if (session && signingOut) return <Splash label="Signing out…" />;
  if (session) return <Navigate to={next ?? "/boards"} replace />;

  const sendLink = async (address: string) => {
    setError(null);
    if (Date.now() < cooldownUntil.current) {
      setError(WAIT_MESSAGE);
      return;
    }
    if (!EMAIL_RE.test(address)) {
      setError("That doesn't look like an email address.");
      emailRef.current?.focus();
      return;
    }
    setSending(true);
    rememberNext(next);
    rememberEmail(address);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: callbackUrl(), shouldCreateUser: true },
    });
    setSending(false);
    if (isRateLimited(otpError)) {
      cooldownUntil.current = Date.now() + COOLDOWN_MS;
      setError(WAIT_MESSAGE);
      return;
    }
    if (otpError) {
      setError("Hmm, that didn't send. Check the address and try again.");
      return;
    }
    cooldownUntil.current = Date.now() + COOLDOWN_MS;
    setSentTo(address);
    setMode("sent");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendLink(email.trim());
  };

  const signInWithGitHub = async () => {
    setError(null);
    rememberNext(next);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: callbackUrl() },
    });
    if (oauthError) setError("We couldn't reach GitHub. Try again in a moment.");
  };

  return (
    <main className="ud-shell ud-dot-grid flex min-h-dvh flex-col items-center px-4 py-12 tablet:px-6">
      <div className="flex w-full max-w-[400px] flex-1 flex-col items-center justify-center gap-8">
        <header className="flex flex-col items-center gap-3 text-center">
          <h1>
            <Wordmark size="display" />
          </h1>
          <p className="text-body text-ink-muted">Sketch it out. Uncle Draw keeps it safe.</p>
        </header>

        <SketchBox seed={hashSeed("login-card")} className="w-full p-6 tablet:p-8">
          {mode === "sent" ? (
            <div className="flex flex-col items-center gap-4 text-center" aria-live="polite">
              <EnvelopeDoodle width={150} />
              <h2 className="font-hand text-h2">Check your inbox.</h2>
              <p>
                We sent a sign-in link to <strong className="break-all">{sentTo}</strong>.
              </p>
              {error ? (
                <p className="text-label text-danger" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  className="text-label text-primary underline underline-offset-4"
                  onClick={() => {
                    setError(null);
                    setMode("form");
                  }}
                >
                  Use a different email
                </button>
                <button
                  type="button"
                  className="text-label text-ink-muted underline underline-offset-4"
                  onClick={() => void sendLink(sentTo)}
                  disabled={sending}
                >
                  Send it again
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {linkError ? (
                <div className="flex flex-col gap-3 bg-danger-soft p-3 text-ink" role="alert">
                  <p>That sign-in link has expired or was already used.</p>
                  <SketchButton
                    size="sm"
                    onClick={() => {
                      const address = email.trim();
                      if (address) void sendLink(address);
                      else emailRef.current?.focus();
                    }}
                  >
                    Send me a new link
                  </SketchButton>
                </div>
              ) : null}
              <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
                <SketchInput
                  ref={emailRef}
                  label="Email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  error={error ?? undefined}
                  required
                />
                <SketchButton type="submit" variant="primary" disabled={sending}>
                  {sending ? "Sending…" : "Send me a magic link"}
                </SketchButton>
              </form>
              <div className="flex items-center gap-3 text-label text-ink-muted" aria-hidden="true">
                <span className="h-px flex-1 bg-ink-faint" />
                or
                <span className="h-px flex-1 bg-ink-faint" />
              </div>
              <SketchButton
                icon={<IconBrandGithub size={20} stroke={1.75} />}
                onClick={() => void signInWithGitHub()}
              >
                Continue with GitHub
              </SketchButton>
            </div>
          )}
        </SketchBox>
      </div>
      <div className="mt-10 text-ink">
        <PencilHandoffDoodle width={240} />
      </div>
    </main>
  );
}
