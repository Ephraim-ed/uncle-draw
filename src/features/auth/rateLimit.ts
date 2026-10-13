/** AUTH-1: the per-address cooldown between magic links. */
export const WAIT_MESSAGE = "Please wait a minute before requesting another link.";

/**
 * Supabase's built-in mailer also caps emails per hour for the whole project
 * (about 2 without custom SMTP). That needs different words than the cooldown.
 */
export const QUOTA_MESSAGE =
  "We've sent too many sign-in emails for now. Please try again in a little while.";

export interface AuthErrorLike {
  status?: number;
  code?: string;
  message?: string;
}

export type RateLimit = { kind: "cooldown"; message: string } | { kind: "quota"; message: string };

/** Classifies a sign-in email error; null when it isn't a rate limit. */
export function classifyRateLimit(error: AuthErrorLike | null | undefined): RateLimit | null {
  if (!error) return null;
  const limited =
    error.status === 429 ||
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_request_rate_limit";
  if (!limited) return null;
  // Per-address cooldown: "For security purposes, you can only request this after 47 seconds."
  if (/after \d+ seconds?/i.test(error.message ?? "")) return { kind: "cooldown", message: WAIT_MESSAGE };
  return { kind: "quota", message: QUOTA_MESSAGE };
}
