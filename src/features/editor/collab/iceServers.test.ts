import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ICE_SERVERS, parseIceServers } from "./iceServers";

describe("parseIceServers (VITE_ICE_SERVERS)", () => {
  it("defaults to public STUN", () => {
    expect(parseIceServers(undefined)).toBe(DEFAULT_ICE_SERVERS);
    expect(parseIceServers("  ")).toBe(DEFAULT_ICE_SERVERS);
  });

  it("takes STUN and TURN servers", () => {
    const servers = [
      { urls: "stun:stun.example.com:3478" },
      { urls: ["turn:turn.example.com:3478"], username: "u", credential: "p" },
    ];
    expect(parseIceServers(JSON.stringify(servers))).toEqual(servers);
  });

  it("falls back, with a warning, on anything else", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(parseIceServers("not json")).toBe(DEFAULT_ICE_SERVERS);
    expect(parseIceServers('[{"url":"stun:x"}]')).toBe(DEFAULT_ICE_SERVERS);
    expect(parseIceServers("[]")).toBe(DEFAULT_ICE_SERVERS);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});
