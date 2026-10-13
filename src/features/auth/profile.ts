import type { User } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "./AuthProvider";

export interface Profile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Name before the "@" of the email (AUTH-5 fallback). */
export function emailName(email: string | undefined | null): string {
  return (email ?? "").split("@")[0] || "friend";
}

function fallbackProfile(user: User): Profile {
  const meta = user.user_metadata as Record<string, unknown>;
  const metaName =
    typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null;
  const metaAvatar = typeof meta.avatar_url === "string" ? meta.avatar_url : null;
  return { id: user.id, displayName: metaName || emailName(user.email), avatarUrl: metaAvatar };
}

export const profileKey = (userId: string) => ["profile", userId] as const;

/** The signed-in user's profile, with a metadata-based fallback while loading. */
export function useProfile(): Profile | null {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: profileKey(user?.id ?? "none"),
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      const fallback = fallbackProfile(user!);
      return {
        id: user!.id,
        displayName: data?.display_name?.trim() || fallback.displayName,
        avatarUrl: data?.avatar_url ?? fallback.avatarUrl,
      };
    },
  });
  if (!user) return null;
  return query.data ?? fallbackProfile(user);
}

export function useUpdateDisplayName() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const trimmed = name.trim().slice(0, 80);
      if (!user || !trimmed) throw new Error("Name can't be empty");
      const { error } = await supabase.from("profiles").update({ display_name: trimmed }).eq("id", user.id);
      if (error) throw error;
      return trimmed;
    },
    onSuccess: (displayName) => {
      if (!user) return;
      queryClient.setQueryData<Profile>(profileKey(user.id), (prev) =>
        prev ? { ...prev, displayName } : prev,
      );
    },
  });
}
