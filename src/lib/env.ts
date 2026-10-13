/** Client-side configuration (tech §12). Only the URL and anon key ever reach the bundle. */
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || undefined;
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || undefined;

export const env = {
  supabaseUrl: url,
  supabaseAnonKey: anonKey,
  /** False when .env.local is missing; the app then shows a setup page. */
  supabaseConfigured: !!url && !!anonKey,
} as const;
