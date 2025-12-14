import { Link } from "react-router-dom";
import { posts } from "@/content/posts";
import { formatDate } from "@/lib/date-format";
import { TerminalCursor, TerminalHeader, TerminalPrompt, TerminalWindow } from "@/components/SecureTerminal";

const Blog = () => {
  return (
    <div className="h-screen bg-black">
      <TerminalWindow aria-label="Blog index">
        <TerminalHeader displayCwd="~/blog" />
        <div className="p-3 sm:p-6 font-mono text-xs sm:text-sm flex-1 overflow-y-auto space-y-4">
          <TerminalPrompt path="~">
            <Link
              to="/"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              cd ..
            </Link>
          </TerminalPrompt>

          <TerminalPrompt path="~/blog" command="ls -la" />

          <div className="pl-2 sm:pl-4 space-y-3">
            {posts.map((post) => (
              <article
                key={post.metadata.slug}
                className="border border-terminal-green/40 bg-black/60 shadow-[0_0_20px_rgba(0,255,0,0.08)]"
              >
                <Link
                  to={`/blog/${post.metadata.slug}`}
                  className="block p-3 sm:p-4 hover:bg-terminal-green/5 focus:outline-none focus:ring-2 focus:ring-terminal-green"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-terminal-cyan whitespace-nowrap">{formatDate(post.metadata.date)}</p>
                    <span className="text-terminal-yellow text-[0.65rem] sm:text-xs uppercase tracking-[0.25em]">
                      post
                    </span>
                  </div>
                  <h2 className="mt-1 text-lg sm:text-xl text-terminal-green">{post.metadata.title}</h2>
                  <p className="mt-1 text-terminal-white/70 leading-relaxed">{post.metadata.excerpt}</p>
                  <p className="mt-3 text-terminal-magenta text-xs inline-flex items-center gap-2">
                    read entry
                    <span aria-hidden="true">→</span>
                  </p>
                </Link>
              </article>
            ))}
          </div>

          <TerminalPrompt path="~/blog">
            <TerminalCursor />
          </TerminalPrompt>
        </div>
      </TerminalWindow>
    </div>
  );
};

export default Blog;
