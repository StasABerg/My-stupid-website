import { Link, useParams } from "react-router-dom";
import { getPostBySlug } from "@/content/posts";
import { TerminalCursor, TerminalHeader, TerminalPrompt, TerminalWindow } from "@/components/SecureTerminal";

const BlogPost = () => {
  const { slug = "" } = useParams();
  const post = getPostBySlug(slug);

  if (!post) {
    return (
      <div className="h-screen bg-black text-terminal-white">
        <TerminalWindow aria-label="Missing blog post">
          <TerminalHeader displayCwd="~/blog/404" />
          <div className="p-4 sm:p-6 font-mono text-xs sm:text-sm flex-1 overflow-y-auto space-y-4">
            <TerminalPrompt path="~/blog" command="cat missing.md" />
            <p className="text-terminal-white/80">
              That entry is lost in the logs. Check the index again or head back to the surface.
            </p>
            <TerminalPrompt path="~/blog">
              <Link
                to="/blog"
                className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
              >
                cd ..
              </Link>
            </TerminalPrompt>
            <TerminalPrompt path="~/blog/404">
              <TerminalCursor />
            </TerminalPrompt>
          </div>
        </TerminalWindow>
      </div>
    );
  }

  const PostComponent = post.default;

  return (
    <div className="h-screen bg-black">
      <TerminalWindow aria-label={`Blog post ${post.metadata.title}`}>
        <TerminalHeader displayCwd={`~/blog/${post.metadata.slug}`} />
        <div className="p-3 sm:p-6 font-mono text-xs sm:text-sm text-terminal-white flex-1 overflow-y-auto space-y-4">
          <TerminalPrompt path="~/blog">
            <Link
              to="/blog"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              cd ..
            </Link>
          </TerminalPrompt>

          <TerminalPrompt command={`cat ${post.metadata.slug}.md`} />

          <div>
            <PostComponent />
          </div>

          <TerminalPrompt path={`~/blog/${post.metadata.slug}`}>
            <Link
              to="/blog"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              cd ..
            </Link>
          </TerminalPrompt>

          <TerminalPrompt path={`~/blog/${post.metadata.slug}`}>
            <TerminalCursor />
          </TerminalPrompt>
        </div>
      </TerminalWindow>
    </div>
  );
};

export default BlogPost;
