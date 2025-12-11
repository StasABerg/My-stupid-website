import { BrowserRouter, Route, Routes, Link } from "react-router-dom";
import Home from "./pages/Home";
import Radio from "./pages/Radio";
import Terminal from "./pages/Terminal";
import Docs from "./pages/Docs";
import SwaggerPage from "./pages/Swagger";
import HowToIndex from "./pages/how-to/HowToIndex";
import HowToTopic from "./pages/how-to/HowToTopic";
import NotFound from "./pages/NotFound";
import Motivation from "./pages/Motivation";
import Konami from "./pages/Konami";
import GitGud from "./pages/GitGud";
import Begud from "./pages/Begud";
import Games from "./pages/Games";
import DoNothingGamePage from "./pages/DoNothingGamePage";

const Nav = () => (
  <nav className="nav">
    <Link href="/">Home</Link>
    <Link href="/radio">Radio</Link>
    <Link href="/terminal">Terminal</Link>
    <Link href="/docs">Docs</Link>
    <Link href="/swagger">Swagger</Link>
    <Link href="/how-to">How-to</Link>
  </nav>
);

const App = () => (
  <BrowserRouter>
    <div className="page">
      <header className="header">
        <span className="brand">Gitgud</span>
        <Nav />
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/radio" element={<Radio />} />
          <Route path="/terminal" element={<Terminal />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/swagger" element={<SwaggerPage />} />
          <Route path="/how-to" element={<HowToIndex />} />
          <Route path="/how-to/:topic" element={<HowToTopic />} />
          <Route path="/motivation" element={<Motivation />} />
          <Route path="/konami" element={<Konami />} />
          <Route path="/gitgud" element={<GitGud />} />
          <Route path="/begud" element={<Begud />} />
          <Route path="/games" element={<Games />} />
          <Route path="/games/do-nothing" element={<DoNothingGamePage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  </BrowserRouter>
);

export default App;
