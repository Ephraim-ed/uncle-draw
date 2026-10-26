import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { env } from "./env";

/**
 * Typed Supabase client. When the env vars are missing the app renders a setup
 * page and never calls this client; the placeholders only keep the module
 * importable (e.g. for the dev-only component kit).
 */
export const supabase = createClient<Database>(
  env.supabaseUrl ?? "http://127.0.0.1:54321",
  env.supabaseAnonKey ?? "missing-anon-key",
  {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      // /auth/callback exchanges the code itself so it can honor `next`.
      detectSessionInUrl: false,
    },
    // Realtime heartbeats from a Web Worker keep on time in background tabs,
    // whose timers browsers throttle (a late heartbeat drops the connection).
    // (Only where there are workers: realtime-js refuses otherwise, e.g. in jsdom.)
    realtime: { worker: typeof Worker !== "undefined" },
  },
);

export type SupabaseClient = typeof supabase;
