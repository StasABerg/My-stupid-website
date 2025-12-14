import { Link } from "react-router-dom";
import { useEffect } from "react";
import { posts } from "@/content/posts";
import { formatLsDate } from "@/lib/date-format";
import { TerminalCursor, TerminalHeader, TerminalPrompt, TerminalWindow } from "@/components/SecureTerminal";

const Blog = () => {
  useEffect(() => {
    const title = "Blog | My Stupid Website";
    const description = "Latest ramblings and updates from the Gitgud terminal.";
    document.title = title;
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = description;
  }, []);

  return (
    <div className="h-screen bg-black">
      <TerminalWindow aria-label="Blog index">
        <TerminalHeader displayCwd="~/blog" />
        <div className="p-3 sm:p-6 font-mono text-xs sm:text-sm text-terminal-white flex-1 overflow-y-auto space-y-4">
          <TerminalPrompt path="~">
            <Link
              to="/"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              cd ..
            </Link>
          </TerminalPrompt>

          <TerminalPrompt command="ls -la" />

          <div className="pl-2 sm:pl-4 space-y-2">
            {posts.map((post) => (
              <p key={post.metadata.slug} className="text-terminal-white">
                <span className="hidden sm:inline whitespace-nowrap">-rw-r--r-- 1 user user 4096 {formatLsDate(new Date(post.metadata.date))} </span>
                <Link
                  to={`/blog/${post.metadata.slug}`}
                  className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan whitespace-nowrap"
                >
                  {post.metadata.slug}
                </Link>
                <span className="text-terminal-green pl-2"># {post.metadata.excerpt}</span>
              </p>
            ))}
          </div>

          <TerminalPrompt
            command={
              <Link
                to="/"
                className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
              >
                cd ..
              </Link>
            }
          />
        </div>
      </TerminalWindow>
    </div>
  );
};

export default Blog;
