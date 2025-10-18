import { Link } from "react-router-dom";

const RadioHeader = () => (
  <>
    <Link
      to="/"
      className="text-terminal-cyan text-xs uppercase tracking-widest hover:underline"
    >
      ← Return to home
    </Link>
    <header className="mt-4 text-center">
      <h1 className="text-3xl sm:text-4xl font-semibold text-terminal-yellow drop-shadow-lg">
        Gitgud Roadtrip Radio
      </h1>
      <p className="mt-2 text-sm text-terminal-white/80">
        Spin the dial, drop the presets, and cruise through thousands of live stations from
        the Radio Browser directory.
      </p>
    </header>
  </>
);

export default RadioHeader;
