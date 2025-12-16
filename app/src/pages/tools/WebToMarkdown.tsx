import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TerminalWindow, TerminalHeader, TerminalPrompt } from "@/components/SecureTerminal";
import { authorizedFetch } from "@/lib/gateway-session";

type ConvertState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; markdown: string }
  | { status: "error"; message: string };

function sanitizeFilename(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/[^a-z0-9.-]+/gi, "-").slice(0, 80);
    return `${host || "page"}.md`;
  } catch {
    return "page.md";
  }
}

async function copyToClipboard(text: string) {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("Clipboard not available");
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const WebToMarkdown = () => {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<ConvertState>({ status: "idle" });
  const [toast, setToast] = useState<string | null>(null);

  const filename = useMemo(() => sanitizeFilename(url), [url]);

  useEffect(() => {
    document.title = "Tools | Web → Markdown";
  }, []);

  const convert = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setState({ status: "error", message: "URL is required" });
      return;
    }
    if (trimmed.length > 2048) {
      setState({ status: "error", message: "URL is too long" });
      return;
    }

    setState({ status: "loading" });
    try {
      const response = await authorizedFetch("/api/fmd/v1/fetch-md", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const data: { error?: string } = await response.json().catch(() => ({}));
          throw new Error(data.error || `Request failed (status ${response.status})`);
        }
        const text = await response.text().catch(() => "");
        throw new Error(text || `Request failed (status ${response.status})`);
      }

      const markdown = await response.text();
      setState({ status: "success", markdown });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Request failed" });
    }
  }, [url]);

  const markdown = state.status === "success" ? state.markdown : "";

  return (
    <div className="h-screen bg-black">
      <TerminalWindow aria-label="Web to markdown tool">
        <TerminalHeader displayCwd="~/tools/web-to-markdown" />
        <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-terminal-white sm:p-6 sm:text-sm space-y-4">
          <TerminalPrompt path="~">
            <Link
              to="/tools"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              cd ../tools
            </Link>
          </TerminalPrompt>

          <TerminalPrompt command="fmd --url" />

          <div className="pl-2 sm:pl-4 space-y-3">
            <label htmlFor="url" className="block text-terminal-green">
              URL:
            </label>
            <input
              id="url"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void convert();
                }
              }}
              className="w-full rounded border border-terminal-green/30 bg-black px-3 py-2 text-terminal-white placeholder:text-terminal-white/40 focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
              aria-describedby="url-help"
            />
            <p id="url-help" className="text-terminal-white/70 text-[0.75rem] sm:text-xs">
              Fetches the page server-side and returns markdown. Only http/https; ports 80/443; no redirects.
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void convert()}
                disabled={state.status === "loading"}
                className="rounded border border-terminal-cyan/50 px-3 py-1 text-terminal-cyan hover:bg-terminal-cyan/10 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
              >
                {state.status === "loading" ? "Converting..." : "Convert"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setState({ status: "idle" });
                  setToast(null);
                }}
                className="rounded border border-terminal-white/20 px-3 py-1 text-terminal-white/80 hover:bg-terminal-white/10 focus:outline-none focus:ring-2 focus:ring-terminal-white/50"
              >
                Clear
              </button>
              <button
                type="button"
                disabled={state.status !== "success" || markdown.length === 0}
                onClick={() => {
                  void copyToClipboard(markdown)
                    .then(() => setToast("Copied to clipboard"))
                    .catch(() => setToast("Copy failed"));
                }}
                className="rounded border border-terminal-green/40 px-3 py-1 text-terminal-green hover:bg-terminal-green/10 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-terminal-green"
              >
                Copy
              </button>
              <button
                type="button"
                disabled={state.status !== "success" || markdown.length === 0}
                onClick={() => downloadText(filename, markdown)}
                className="rounded border border-terminal-magenta/40 px-3 py-1 text-terminal-magenta hover:bg-terminal-magenta/10 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
              >
                Download
              </button>
            </div>

            {toast ? <p className="text-terminal-green text-[0.75rem] sm:text-xs">{toast}</p> : null}

            {state.status === "error" ? (
              <p className="text-red-400 break-words">{state.message}</p>
            ) : null}

            <TerminalPrompt command="cat output.md" />
            <textarea
              readOnly
              value={markdown}
              className="w-full min-h-[40vh] rounded border border-terminal-green/20 bg-black p-3 text-terminal-white focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
              aria-label="Markdown output"
            />
          </div>
        </div>
      </TerminalWindow>
    </div>
  );
};

export default WebToMarkdown;

