/** Client-side configuration (tech §12). Only public values ever reach the bundle. */
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || undefined;
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || undefined;

function originOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

export const env = {
  supabaseUrl: url,
  supabaseAnonKey: anonKey,
  /** False when .env.local is missing; the app then shows a setup page. */
  supabaseConfigured: !!url && !!anonKey,
  /**
   * The public address of the app, e.g. https://uncle-draw.vercel.app. Set on
   * production builds (see vite.config.ts); unset in dev, tests and previews.
   */
  siteUrl: originOf((import.meta.env.VITE_SITE_URL as string | undefined)?.trim()),
} as const;
