import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../../lib/supabase";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** True until the stored session has been read. */
  loading: boolean;
  /** Set during an explicit sign-out, so guards go to /login without a return-to. */
  signingOut: boolean;
  setSigningOut: (value: boolean) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Exposes the Supabase session and keeps it current (tech §8). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      setLoading(false);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") setSigningOut(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, loading, signingOut, setSigningOut }),
    [session, loading, signingOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** For pages behind <RequireAuth>, where a user always exists. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error("useUser called without a signed-in user");
  return user;
}
