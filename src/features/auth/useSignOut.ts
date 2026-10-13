import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { clearUserCache } from "../../lib/localCache";
import { supabase } from "../../lib/supabase";
import { flushAll } from "../editor/saveRegistry";
import { useAuth } from "./AuthProvider";

/**
 * Flush pending saves → clear this user's local cache → /login → sign out (AUTH-3).
 * Leaving the guarded page first means no route guard sees the session vanish
 * (which would redirect to /login?next=…).
 */
export function useSignOut() {
  const { user, setSigningOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await flushAll();
    if (user) await clearUserCache(user.id);
    setSigningOut(true);
    navigate("/login", { replace: true });
    try {
      await supabase.auth.signOut();
    } finally {
      queryClient.clear();
      setSigningOut(false);
    }
  }, [user, setSigningOut, navigate, queryClient]);
}
