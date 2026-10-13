import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { Splash } from "../../components/ui/Splash";
import { loginPathFor } from "../../lib/safeNext";
import { supabase } from "../../lib/supabase";
import { takeNext } from "./authNext";

/**
 * /auth/callback: finishes the PKCE exchange, then sends the user where they
 * were going (tech §8). Cancelling on GitHub returns to /login without an
 * error banner (AUTH-2); a bad or expired magic link shows one (AUTH-1).
 */
export function AuthCallback() {
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice; codes are single-use.
    started.current = true;

    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const error = query.get("error") ?? hash.get("error");
    const errorCode = query.get("error_code") ?? hash.get("error_code");
    const code = query.get("code");
    const next = takeNext();

    const toLogin = (withError: boolean) => {
      const base = loginPathFor(next ?? "/");
      const url = withError ? `${base}${base.includes("?") ? "&" : "?"}error=link` : base;
      navigate(url, { replace: true });
    };

    void (async () => {
      if (error) {
        // GitHub's "Cancel" comes back as access_denied with no error_code.
        const cancelled = error === "access_denied" && !errorCode;
        toLogin(!cancelled);
        return;
      }
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          toLogin(true);
          return;
        }
        navigate(next ?? "/boards", { replace: true });
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) navigate(next ?? "/boards", { replace: true });
      else toLogin(true);
    })();
  }, [navigate]);

  return <Splash label="Signing you in…" />;
}
