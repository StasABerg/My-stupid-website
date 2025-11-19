
import { useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { TerminalWindow, TerminalHeader, TerminalPrompt } from "@/components/SecureTerminal";
import { HOW_TO_TOPICS } from "./topics";

const HowToTopic = () => {
  const { topic = "" } = useParams();
  const normalized = topic.toLowerCase();
  const topicInfo = HOW_TO_TOPICS.find((entry) => entry.slug === normalized);
  const openedRef = useRef(false);

  useEffect(() => {
    if (!topicInfo || openedRef.current) {
      return;
    }
    const timer = setTimeout(() => {
      openedRef.current = true;
      const url = `https://www.google.com/search?q=${encodeURIComponent(topicInfo.query)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    }, 3000);
    return () => clearTimeout(timer);
  }, [topicInfo]);

  if (!topicInfo) {
    return (
      <div className="h-screen bg-black text-terminal-green flex items-center justify-center p-6">
        <TerminalWindow>
          <TerminalHeader displayCwd="~/briefings/unknown" />
          <div className="p-4 font-mono text-sm text-center space-y-4">
            <TerminalPrompt command="cat missing.md" />
            <p className="text-terminal-white/70">That topic isn't wired up yet. Check the list again.</p>
            <TerminalPrompt command="cd .." />
            <Link to="/how-to" className="text-terminal-cyan hover:text-terminal-yellow underline">
              return /how-to
            </Link>
          </div>
        </TerminalWindow>
      </div>
    );
  }

  const heading = topicInfo.title;
  const message = topicInfo.description;
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(topicInfo.query)}`;

  return (
    <div className="h-screen bg-black">
      <TerminalWindow>
        <TerminalHeader displayCwd={`~/briefings/${topicInfo.slug}`} />
        <div className="p-4 sm:p-6 font-mono text-xs sm:text-sm text-terminal-white flex-1 overflow-y-auto space-y-4">
          <TerminalPrompt command={`cat ${topicInfo.slug}.md`} />
          <div>
            <p className="text-terminal-yellow text-lg">{heading}</p>
            <p className="text-terminal-white/70">{message}</p>
          </div>
          <TerminalPrompt command={`open "${topicInfo.query}"`} />
          <p className="text-terminal-white/60">
            Launching the briefing tab in 3 seconds…{" "}
            <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="text-terminal-yellow underline">
              click here if nothing happens
            </a>
            .
          </p>
          <TerminalPrompt command="cd .." />
          <Link to="/how-to" className="text-terminal-cyan hover:text-terminal-yellow underline">
            return /how-to
          </Link>
        </div>
      </TerminalWindow>
    </div>
  );
};

export default HowToTopic;
