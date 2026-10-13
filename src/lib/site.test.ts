import { describe, expect, it } from "vitest";
import { classifyRateLimit, QUOTA_MESSAGE, WAIT_MESSAGE } from "../features/auth/rateLimit";
import { canonicalRedirect } from "./site";

const at = (href: string) => {
  const u = new URL(href);
  return { origin: u.origin, hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash };
};

describe("canonicalRedirect (one public address)", () => {
  const SITE = "https://uncle-draw.vercel.app";

  it("moves other aliases to the same page on the public domain", () => {
    expect(canonicalRedirect(at("https://uncle-draw-team.vercel.app/b/123?x=1#y"), SITE)).toBe(
      "https://uncle-draw.vercel.app/b/123?x=1#y",
    );
  });

  it("stays put on the public domain, on localhost, or when no site URL is set", () => {
    expect(canonicalRedirect(at("https://uncle-draw.vercel.app/boards"), SITE)).toBeNull();
    expect(canonicalRedirect(at("http://localhost:5173/boards"), SITE)).toBeNull();
    expect(canonicalRedirect(at("http://127.0.0.1:4173/boards"), SITE)).toBeNull();
    expect(canonicalRedirect(at("https://uncle-draw-abc.vercel.app/"), undefined)).toBeNull();
  });
});

describe("classifyRateLimit (AUTH-1)", () => {
  it("the per-address cooldown says wait a minute", () => {
    expect(
      classifyRateLimit({
        status: 429,
        code: "over_email_send_rate_limit",
        message: "For security purposes, you can only request this after 47 seconds.",
      }),
    ).toEqual({ kind: "cooldown", message: WAIT_MESSAGE });
  });

  it("the project-wide email quota says so instead", () => {
    expect(
      classifyRateLimit({
        status: 429,
        code: "over_email_send_rate_limit",
        message: "email rate limit exceeded",
      }),
    ).toEqual({ kind: "quota", message: QUOTA_MESSAGE });
  });

  it("other errors aren't rate limits", () => {
    expect(classifyRateLimit({ status: 400, code: "validation_failed", message: "bad email" })).toBeNull();
    expect(classifyRateLimit(null)).toBeNull();
  });
});
