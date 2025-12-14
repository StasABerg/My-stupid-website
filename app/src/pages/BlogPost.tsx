import { Link, useParams } from "react-router-dom";
import { useEffect } from "react";
import { getPostBySlug } from "@/content/posts";
import { TerminalCursor, TerminalHeader, TerminalPrompt, TerminalWindow } from "@/components/SecureTerminal";

const BlogPost = () => {
  const { slug = "" } = useParams();
  const post = getPostBySlug(slug);

  useEffect(() => {
    const metaDescription = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    const ensureMeta = () => {
      let el = metaDescription;
      if (!el) {
        el = document.createElement("meta");
        el.name = "description";
        document.head.appendChild(el);
      }
      return el;
    };

    if (!post) {
      document.title = "Entry not found | Blog";
      ensureMeta().content = "Requested blog entry was not found.";
      return;
    }

    const title = `${post.metadata.title} | Gitgud Blog`;
    const description = post.metadata.excerpt ?? "Gitgud blog entry.";

    document.title = title;
    ensureMeta().content = description;

    const ogTitle = document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null;
    const ogDescription = document.querySelector('meta[property="og:description"]') as HTMLMetaElement | null;
    const twitterCard = document.querySelector('meta[name="twitter:card"]') as HTMLMetaElement | null;

    const ensureOg = (name: string, prop?: string) => {
      let el = prop
        ? (document.querySelector(`meta[property="${prop}"]`) as HTMLMetaElement | null)
        : (document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null);
      if (!el) {
        el = document.createElement("meta");
        if (prop) {
          el.setAttribute("property", prop);
        } else {
          el.name = name;
        }
        document.head.appendChild(el);
      }
      return el;
    };

    ensureOg("twitter:card").content = "summary";
    ensureOg("og:title", "og:title").content = title;
    ensureOg("og:description", "og:description").content = description;
  }, [post]);

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
