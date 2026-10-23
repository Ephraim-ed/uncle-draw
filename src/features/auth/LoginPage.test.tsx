import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";

const flags = vi.hoisted(() => ({ emailSignIn: false }));
const auth = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(async () => ({ error: null as Error | null })),
  signInWithOtp: vi.fn(async () => ({ error: null })),
}));

vi.mock("../../lib/env", () => ({
  env: {
    get emailSignIn() {
      return flags.emailSignIn;
    },
  },
}));
vi.mock("../../lib/supabase", () => ({ supabase: { auth } }));
vi.mock("./AuthProvider", () => ({ useAuth: () => ({ session: null, loading: false, signingOut: false }) }));

const { LoginPage } = await import("./LoginPage");

describe("LoginPage (AUTH-1/2)", () => {
  beforeEach(() => {
    flags.emailSignIn = false;
    vi.clearAllMocks();
  });

  it("offers GitHub only, unless email sign-in is turned on", () => {
    renderWithProviders(<LoginPage />, { route: "/login" });
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send me a magic link" })).not.toBeInTheDocument();
  });

  it("shows the magic link form next to GitHub with VITE_EMAIL_SIGN_IN", () => {
    flags.emailSignIn = true;
    renderWithProviders(<LoginPage />, { route: "/login" });
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send me a magic link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
  });

  it("signs in with GitHub, and says so when GitHub can't be reached", async () => {
    const user = userEvent.setup();
    auth.signInWithOAuth.mockResolvedValueOnce({ error: new Error("offline") });
    renderWithProviders(<LoginPage />, { route: "/login" });
    await user.click(screen.getByRole("button", { name: "Continue with GitHub" }));
    expect(auth.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: "github" }));
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't reach GitHub");
  });

  it("an expired magic link without email sign-in just says so", () => {
    renderWithProviders(<LoginPage />, { route: "/login?error=link" });
    expect(screen.getByRole("alert")).toHaveTextContent("expired or was already used");
    expect(screen.queryByRole("button", { name: "Send me a new link" })).not.toBeInTheDocument();
  });
});
