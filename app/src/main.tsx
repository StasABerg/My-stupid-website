import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";

import Home from "./pages/Home";
import Documents from "./pages/Documents";
import Games from "./pages/Games";
import DoNothingGamePage from "./pages/games/DoNothingGamePage";
import NotFound from "./pages/NotFound";

const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/documents", element: <Documents /> },
  { path: "/games", element: <Games /> },
  { path: "/games/do-nothing", element: <DoNothingGamePage /> },
  { path: "*", element: <NotFound /> },
]);

createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />
);
