import { Link } from "react-router-dom";

const Games = () => (
  <section className="card">
    <h1>Games</h1>
    <p>Lightweight fun only.</p>
    <Link href="/games/do-nothing" className="btn">
      Do nothing game
    </Link>
  </section>
);

export default Games;
