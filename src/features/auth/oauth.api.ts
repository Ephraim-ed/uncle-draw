import { supabase } from "../../lib/supabase";

/**
 * The consent step of signing in to Uncle Draw from another app (AI-1, the
 * Claude connector). Supabase Auth runs the OAuth server; we ask the user.
 */

/** Who's asking and for what, or, when the user already said yes, where to go. */
export type Authorization = NonNullable<
  Awaited<ReturnType<typeof supabase.auth.oauth.getAuthorizationDetails>>["data"]
>;

export async function getAuthorization(authorizationId: string): Promise<Authorization> {
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error) throw error;
  return data;
}

/** Says yes; returns where to send the browser (back to the app, with a code). */
export async function approveAuthorization(authorizationId: string): Promise<string> {
  const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationId, {
    skipBrowserRedirect: true,
  });
  if (error) throw error;
  return data.redirect_url;
}

/** Says no; returns where to send the browser (back to the app, with an error). */
export async function denyAuthorization(authorizationId: string): Promise<string> {
  const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationId, {
    skipBrowserRedirect: true,
  });
  if (error) throw error;
  return data.redirect_url;
}

/** Leaves Uncle Draw for the other app: a full page load, not a route change. */
export function goTo(url: string) {
  window.location.assign(url);
}
