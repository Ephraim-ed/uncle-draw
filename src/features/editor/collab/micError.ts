/** Why the microphone couldn't start, in plain words (VISUAL_DESIGN.md §2). */
export function micErrorMessage(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Uncle Draw can't use your microphone. Allow it in your browser's site settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone found. Plug one in and try again.";
    case "NotReadableError":
    case "AbortError":
      return "Your microphone is busy in another app. Close it there and try again.";
    case "NotSupportedError":
      return "Voice needs a secure (https) connection and a recent browser.";
    default:
      return "Hmm, voice didn't start. Try again.";
  }
}
