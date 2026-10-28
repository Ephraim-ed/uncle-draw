import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";

const api = vi.hoisted(() => ({
  getAuthorization: vi.fn(),
  approveAuthorization: vi.fn(),
  denyAuthorization: vi.fn(),
  goTo: vi.fn(),
}));
vi.mock("./oauth.api", () => api);

const { default: OAuthConsentPage } = await import("./OAuthConsentPage");

const details = {
  authorization_id: "auth-1",
  redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  client: { id: "c1", name: "Claude", uri: "https://claude.ai", logo_uri: "" },
  user: { id: "u1", email: "me@example.com" },
  scope: "openid email",
};

const open = (search = "?authorization_id=auth-1") =>
  renderWithProviders(<OAuthConsentPage />, { route: `/oauth/consent${search}` });

describe("OAuthConsentPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAuthorization.mockResolvedValue(details);
    api.approveAuthorization.mockResolvedValue("https://claude.ai/api/mcp/auth_callback?code=abc");
    api.denyAuthorization.mockResolvedValue("https://claude.ai/api/mcp/auth_callback?error=access_denied");
  });

  it("shows client name and redirect host", async () => {
    open();
    expect(
      await screen.findByRole("heading", { name: "Claude wants to use Uncle Draw as you" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/claude\.ai/)).toBeInTheDocument();
    expect(screen.getByText("It can see, create and change boards you can edit.")).toBeInTheDocument();
    expect(api.getAuthorization).toHaveBeenCalledWith("auth-1");
  });

  it("Allow approves and redirects to the returned url", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Allow" }));
    await waitFor(() =>
      expect(api.goTo).toHaveBeenCalledWith("https://claude.ai/api/mcp/auth_callback?code=abc"),
    );
    expect(api.approveAuthorization).toHaveBeenCalledWith("auth-1");
    expect(api.denyAuthorization).not.toHaveBeenCalled();
  });

  it("Cancel denies and redirects", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(api.goTo).toHaveBeenCalledWith("https://claude.ai/api/mcp/auth_callback?error=access_denied"),
    );
    expect(api.denyAuthorization).toHaveBeenCalledWith("auth-1");
  });

  it("already-consented details redirect immediately", async () => {
    api.getAuthorization.mockResolvedValue({
      redirect_url: "https://claude.ai/api/mcp/auth_callback?code=again",
    });
    open();
    await waitFor(() =>
      expect(api.goTo).toHaveBeenCalledWith("https://claude.ai/api/mcp/auth_callback?code=again"),
    );
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
  });

  it("missing authorization_id shows the incomplete-link message", async () => {
    open("");
    expect(await screen.findByText("This sign-in link isn't complete.")).toBeInTheDocument();
    expect(api.getAuthorization).not.toHaveBeenCalled();
  });

  it("a request that fails to load says why, and can be tried again", async () => {
    api.getAuthorization.mockRejectedValueOnce(new Error("authorization request not found or expired"));
    open();
    expect(await screen.findByText("We couldn't open this sign-in request.")).toBeInTheDocument();
    expect(screen.getByText(/authorization request not found or expired/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to boards" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Allow" })).toBeInTheDocument();
    expect(api.getAuthorization).toHaveBeenCalledTimes(2);
  });

  it("a failed Allow says why instead of claiming the request expired", async () => {
    api.approveAuthorization.mockRejectedValueOnce(new Error("invalid redirect"));
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Allow" }));
    expect(await screen.findByText(/invalid redirect/)).toBeInTheDocument();
    expect(api.goTo).not.toHaveBeenCalled();
  });
});
