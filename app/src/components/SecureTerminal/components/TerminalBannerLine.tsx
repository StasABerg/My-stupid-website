import { Link } from "react-router-dom";

interface TerminalBannerLineProps {
  line: string;
  color: string;
}

function TerminalBannerLine({ line, color }: TerminalBannerLineProps) {
  // Handle special formatting for specific lines
  if (line === "Commands run against a locked-down Kubernetes pod with whitelisted binaries and an ephemeral filesystem.") {
    return (
      <p className="text-terminal-white">
        {line}
      </p>
    );
  }
  
  if (line === "Need to leave? cd ~") {
    return (
      <p className="text-terminal-white">
        Need to leave?{" "}
        <Link
          to="/"
          className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
          aria-label="Go back to home directory"
        >
          cd ~
        </Link>
      </p>
    );
  }

  return (
    <p className={color}>
      {line}
    </p>
  );
}

export default TerminalBannerLine;
