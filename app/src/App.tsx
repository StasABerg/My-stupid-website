import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import RouteLoader from "@/components/route-loader";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";

const IndexPage = lazy(() => import("./pages/Index"));
const DocumentsPage = lazy(() => import("./pages/Documents"));
const GamesPage = lazy(() => import("./pages/Games"));
const DoNothingGamePage = lazy(() => import("./pages/DoNothingGamePage"));
const NotFoundPage = lazy(() => import("./pages/NotFound"));
const TerminalPage = lazy(() => import("./pages/Terminal"));
const RadioPage = lazy(() => import("./pages/Radio"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route path="/" element={<IndexPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/games" element={<GamesPage />} />
            <Route path="/games/do-nothing" element={<DoNothingGamePage />} />
            <Route path="/terminal" element={<TerminalPage />} />
            <Route path="/radio" element={<RadioPage />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
