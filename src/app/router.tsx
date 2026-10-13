import { lazy, Suspense, type ReactNode } from "react";
import { Outlet, createBrowserRouter, type RouteObject } from "react-router";
import { Splash } from "../components/ui/Splash";
import { AuthCallback } from "../features/auth/AuthCallback";
import { LoginPage } from "../features/auth/LoginPage";
import { RequireAuth, RootRedirect } from "../features/auth/RequireAuth";
import { DashboardPage } from "../features/boards/DashboardPage";
import { env } from "../lib/env";
import { ErrorPage } from "../pages/ErrorPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { SetupPage } from "../pages/SetupPage";

// The Excalidraw bundle stays out of the dashboard's initial load (tech §4.1).
const EditorPage = lazy(() => import("../features/editor/EditorPage"));
const SharePage = lazy(() => import("../features/share/SharePage"));
// Dev-only component preview; `import.meta.env.DEV` is false in builds, so the chunk is dropped.
const KitPage = import.meta.env.DEV ? lazy(() => import("../pages/KitPage")) : null;

function Lazy({ children, label }: { children: ReactNode; label?: string }) {
  return <Suspense fallback={<Splash label={label} />}>{children}</Suspense>;
}

const devRoutes: RouteObject[] = KitPage
  ? [
      {
        path: "/_kit",
        element: (
          <Lazy>
            <KitPage />
          </Lazy>
        ),
      },
    ]
  : [];

/** Routes (tech §9). */
export const routes: RouteObject[] = [
  {
    element: <Outlet />,
    errorElement: <ErrorPage />,
    children: env.supabaseConfigured
      ? [
          { path: "/", element: <RootRedirect /> },
          { path: "/login", element: <LoginPage /> },
          { path: "/auth/callback", element: <AuthCallback /> },
          {
            element: <RequireAuth />,
            children: [
              { path: "/boards", element: <DashboardPage /> },
              {
                path: "/b/:boardId",
                element: (
                  <Lazy label="Opening your board…">
                    <EditorPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            path: "/s/:token",
            element: (
              <Lazy label="Opening the board…">
                <SharePage />
              </Lazy>
            ),
          },
          ...devRoutes,
          { path: "*", element: <NotFoundPage /> },
        ]
      : [...devRoutes, { path: "*", element: <SetupPage /> }],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
