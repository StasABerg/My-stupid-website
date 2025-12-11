import { Link } from "react-router-dom";

const Home = () => (
  <section className="card">
    <h1>Gitgud — Lite</h1>
    <p>Single ultra-light experience. No fonts, minimal JS, under 14 KB per chunk.</p>
    <ul className="list">
      <li>
        <Link href="/radio">Radio</Link>
      </li>
      <li>
        <Link href="/terminal">Terminal sandbox</Link>
      </li>
      <li>
        <Link href="/docs">Docs</Link>
      </li>
      <li>
        <Link href="/how-to">How-to</Link>
      </li>
      <li>
        <Link href="/motivation">Motivation</Link>
      </li>
      <li>
        <Link href="/konami">Secrets</Link>
      </li>
      <li>
        <Link href="/games">Games</Link>
      </li>
    </ul>
  </section>
);

export default Home;
