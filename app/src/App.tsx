import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import RouteLoader from "@/components/route-loader";
import CookieConsentBanner from "./components/CookieConsentBanner";
import { useKonamiCode } from "@/hooks/useKonamiCode";

const IndexPage = lazy(() => import("./pages/Index"));
const DocumentsPage = lazy(() => import("./pages/Documents"));
const GamesPage = lazy(() => import("./pages/Games"));
const DoNothingGamePage = lazy(() => import("./pages/DoNothingGamePage"));
const NotFoundPage = lazy(() => import("./pages/NotFound"));
const TerminalPage = lazy(() => import("./pages/Terminal"));
const RadioPage = lazy(() => import("./pages/Radio"));
const BlogPage = lazy(() => import("./pages/Blog"));
const BlogPostPage = lazy(() => import("./pages/BlogPost"));
const TerminalDocsPage = lazy(() => import("./pages/TerminalDocs"));
const RadioDocsPage = lazy(() => import("./pages/RadioDocs"));
const SwaggerDirectoryPage = lazy(() => import("./pages/Swagger"));
const GatewayDocsPage = lazy(() => import("./pages/GatewayDocs"));
const PrivacyPage = lazy(() => import("./pages/Privacy"));
const KonamiPage = lazy(() => import("./pages/Konami"));
const BegudPage = lazy(() => import("./pages/Begud"));
const GitGudPage = lazy(() => import("./pages/GitGud"));
const MotivationPage = lazy(() => import("./pages/Motivation"));
const HowToIndexPage = lazy(() => import("./pages/how-to/HowToIndex"));
const HowToTopicPage = lazy(() => import("./pages/how-to/HowToTopic"));

const KonamiListener = () => {
  const navigate = useNavigate();
  useKonamiCode(() => navigate("/konami"));
  return null;
};

const App = () => (
  <BrowserRouter>
    <KonamiListener />
    <Suspense fallback={<RouteLoader />}>
      <Routes>
        <Route path="/" element={<IndexPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/games" element={<GamesPage />} />
        <Route path="/games/do-nothing" element={<DoNothingGamePage />} />
        <Route path="/terminal" element={<TerminalPage />} />
        <Route path="/terminal/docs" element={<TerminalDocsPage />} />
        <Route path="/radio" element={<RadioPage />} />
        <Route path="/blog" element={<BlogPage />} />
        <Route path="/blog/:slug" element={<BlogPostPage />} />
        <Route path="/radio/docs" element={<RadioDocsPage />} />
        <Route path="/gateway/docs" element={<GatewayDocsPage />} />
        <Route path="/swagger" element={<SwaggerDirectoryPage />} />
        <Route path="/konami" element={<KonamiPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/motivation" element={<MotivationPage />} />
        <Route path="/begud" element={<BegudPage />} />
        <Route path="/gitgud" element={<GitGudPage />} />
        <Route path="/how-to" element={<HowToIndexPage />} />
        <Route path="/how-to/:topic" element={<HowToTopicPage />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
    <CookieConsentBanner />
  </BrowserRouter>
);

export default App;
