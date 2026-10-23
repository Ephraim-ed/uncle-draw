import { z } from "zod";
import { env } from "../../../lib/env";

const iceServersSchema = z
  .array(
    z.object({
      urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
      username: z.string().optional(),
      credential: z.string().optional(),
    }),
  )
  .min(1);

/** Public STUN servers: enough for most home and office networks. */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];

/**
 * VITE_ICE_SERVERS: a JSON array of RTCIceServer, e.g. to add a TURN server
 * (COLLAB-5/7). Parsed here, in the editor chunk, to keep Zod out of the shell.
 */
export function parseIceServers(raw: string | undefined): RTCIceServer[] {
  if (!raw?.trim()) return DEFAULT_ICE_SERVERS;
  try {
    const parsed = iceServersSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // reported below
  }
  console.warn("VITE_ICE_SERVERS isn't a JSON array of ICE servers; using the default STUN servers.");
  return DEFAULT_ICE_SERVERS;
}

export const iceServers = (): RTCIceServer[] => parseIceServers(env.iceServersJson);
