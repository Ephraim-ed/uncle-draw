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
  /**
   * Show magic-link sign-in (AUTH-1) next to GitHub. Off unless
   * VITE_EMAIL_SIGN_IN=true: local Supabase and the E2E tests turn it on,
   * since GitHub sign-in is off there.
   */
  emailSignIn: (import.meta.env.VITE_EMAIL_SIGN_IN as string | undefined)?.trim() === "true",
  /** STUN/TURN servers for voice and screen sharing, as JSON (parsed in collab/iceServers.ts). */
  iceServersJson: (import.meta.env.VITE_ICE_SERVERS as string | undefined)?.trim() || undefined,
} as const;
