/**
 * The connector server's settings (AI-1), from the same Vercel env vars the
 * app builds with. Read when used, so tests can set them first.
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

export const serverEnv = {
  get supabaseUrl(): string {
    return required("VITE_SUPABASE_URL").replace(/\/+$/, "");
  },
  get anonKey(): string {
    return required("VITE_SUPABASE_ANON_KEY");
  },
  /** Where board links point: the app's public address. */
  get siteUrl(): string {
    const explicit = process.env.VITE_SITE_URL?.trim();
    if (explicit) return explicit.replace(/\/+$/, "");
    const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
    return production ? `https://${production}` : "http://localhost:5173";
  },
};
