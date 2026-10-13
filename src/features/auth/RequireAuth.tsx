import { Navigate, Outlet, useLocation } from "react-router";
import { Splash } from "../../components/ui/Splash";
import { loginPathFor } from "../../lib/safeNext";
import { useAuth } from "./AuthProvider";

/** Route guard for /boards and /b/:id (AUTH-4). */
export function RequireAuth() {
  const { session, loading, signingOut } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!session) {
    // An explicit sign-out goes to plain /login (AUTH-3); anything else keeps the return-to.
    const target = signingOut
      ? "/login"
      : loginPathFor(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate to={target} replace />;
  }
  return <Outlet />;
}

/** `/`: boards when signed in, otherwise login. */
export function RootRedirect() {
  const { session, loading } = useAuth();
  if (loading) return <Splash />;
  return <Navigate to={session ? "/boards" : "/login"} replace />;
}
