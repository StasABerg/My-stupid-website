import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { authorizedFetch } from "@/lib/gateway-session";

type ExecuteResponse = {
  command: string;
  output: string[];
  error?: boolean;
  cwd: string;
  displayCwd?: string;
  clear?: boolean;
};

type HistoryEntry = {
  id: number;
  cwd: string;
  command: string;
  output: string[];
  isError: boolean;
};

const FALLBACK_TERMINAL_BASE = "/api/terminal/";

const RAW_TERMINAL_BASE =
  (import.meta.env.VITE_TERMINAL_API_BASE_URL ?? import.meta.env.VITE_TERMINAL_API_BASE ?? FALLBACK_TERMINAL_BASE)
    .trim() || FALLBACK_TERMINAL_BASE;

if (import.meta.env.DEV) {
  console.debug("terminal-service.base", { raw: RAW_TERMINAL_BASE, fallback: FALLBACK_TERMINAL_BASE });
}

function buildTerminalUrl(path: string): string {
  const segment = path.replace(/^\/+/, "");
  const base = RAW_TERMINAL_BASE;

  if (base.startsWith("http://") || base.startsWith("https://")) {
    try {
      const baseUrl = new URL(base.endsWith("/") ? base : `${base}/`);
      baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, "")}/${segment}`;
      return baseUrl.toString();
    } catch {
      // fall through to relative handling if the URL is malformed
    }
  }

  const normalizedBase = (base.startsWith("/") ? base : `/${base}`).replace(/\/+$/, "");
  const relativePath = `${normalizedBase}/${segment}`;

  if (typeof window === "undefined") {
    const origin = "http://localhost";
    return new URL(relativePath, origin).toString();
  }

  const fullUrl = new URL(relativePath, window.location.origin).toString();
  if (import.meta.env.DEV) {
    console.debug("terminal-service.resolved-url", { path, base, relativePath, fullUrl });
  }
  return fullUrl;
}

const toDisplayPath = (virtualPath: string | undefined | null): string => {
  if (!virtualPath || virtualPath === "/") return "~";
  if (virtualPath === "/home/demo") return "~";
  if (virtualPath.startsWith("/home/demo/")) {
    return `~${virtualPath.slice("/home/demo".length)}`;
  }
  return virtualPath;
};

export function useTerminal() {
  const navigate = useNavigate();
  const [virtualCwd, setVirtualCwd] = useState<string>("/home/demo");
  const [input, setInput] = useState<string>("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [supportedCommands, setSupportedCommands] = useState<string[]>([]);
  const [motd, setMotd] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const commandId = useRef(0);

  // Computed values
  const displayCwd = toDisplayPath(virtualCwd);

  const bannerLines = (() => {
    const lines = [
      "Commands run against a locked-down Kubernetes pod with whitelisted binaries and an ephemeral filesystem.",
      "Need to leave? cd ~",
      "",
    ];
    
    if (loading) {
      lines.push("Establishing secure connection to sandbox pod...");
    } else if (connectionError) {
      lines.push(connectionError);
    } else {
      lines.push("Connected to isolated sandbox pod. Commands run inside a locked-down container.");
      if (supportedCommands.length) {
        lines.push(`Allowed commands: ${supportedCommands.join(", ")}`);
      }
      if (motd.length) {
        lines.push("---- motd ----", ...motd, "--------------");
      }
    }
    
    return lines;
  })();

  const bannerColor = connectionError ? "text-terminal-red" : "text-terminal-cyan";

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const infoUrl = buildTerminalUrl("info");
        if (import.meta.env.DEV) {
          console.debug("terminal-service.request", { url: infoUrl, method: "GET" });
        }

        const response = await authorizedFetch(infoUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Terminal-Debug": encodeDebugHeader({ stage: "info", url: infoUrl }),
          },
        });

        if (!response.ok) {
          const errorPayload = await response
            .clone()
            .text()
            .catch(() => "<unable to parse>");
          const error = new Error(`status ${response.status}`);
          if (import.meta.env.DEV) {
            console.error("terminal-service.info_error", { url: infoUrl, status: response.status, body: errorPayload });
          }
          throw error;
        }

        const payload = await response.json();
        if (cancelled) return;

        const nextVirtual = typeof payload.virtualCwd === "string"
          ? payload.virtualCwd
          : "/home/demo";

        setVirtualCwd(nextVirtual);
        setSupportedCommands(
          Array.isArray(payload.supportedCommands)
            ? payload.supportedCommands
            : [],
        );
        setMotd(Array.isArray(payload.motd) ? payload.motd : []);
        setConnectionError(null);
      } catch (error) {
        if (cancelled) return;
        setConnectionError("Unable to reach the sandbox terminal service.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  const runCommand = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      const previousDisplayCwd = displayCwd;
      const previousVirtualCwd = virtualCwd;

      setCommandHistory((prev) => [...prev, raw]);
      setHistoryIndex(null);

      if (trimmed === "clear") {
        setHistory([]);
        setInput("");
        return;
      }

      // Handle local commands when backend is unavailable
      if (connectionError) {
        let output: string[] = [];
        let isError = false;

        if (trimmed === "help") {
          output = [
            "Available commands:",
            "  help     - Show this help message",
            "  clear    - Clear the terminal",
            "  pwd      - Print working directory",
            "  whoami   - Print current user",
            "  date     - Print current date",
            "  echo     - Print arguments",
            "",
            "Note: Backend service is unavailable. Some commands may not work as expected."
          ];
        } else if (trimmed === "pwd") {
          output = [previousDisplayCwd];
        } else if (trimmed === "whoami") {
          output = ["sandbox"];
        } else if (trimmed === "date") {
          output = [new Date().toString()];
        } else if (trimmed.startsWith("echo ")) {
          output = [trimmed.slice(5)];
        } else if (trimmed === "cd" || trimmed === "cd ~" || trimmed.startsWith("cd ")) {
          const newPath = trimmed === "cd" ? "~" : trimmed.slice(3).trim();
          if (newPath === "~" || newPath === "" || newPath === "/home/sandbox") {
            // Navigate back to home page using React Router
            navigate("/");
            return;
          } else {
            output = ["cd: command not available in offline mode"];
            isError = true;
          }
        } else {
          output = [
            `Command '${trimmed}' not available in offline mode.`,
            "Type 'help' to see available commands."
          ];
          isError = true;
        }

        const entry: HistoryEntry = {
          id: commandId.current++,
          cwd: previousDisplayCwd,
          command: raw,
          output,
          isError,
        };

        setHistory((prev) => [...prev, entry]);
        setInput("");
        return;
      }

      try {
        setIsSubmitting(true);
        const executeUrl = buildTerminalUrl("execute");
        if (import.meta.env.DEV) {
          console.debug("terminal-service.request", {
            url: executeUrl,
            method: "POST",
            body: { input: raw, cwd: previousVirtualCwd },
          });
        }

        const response = await authorizedFetch(executeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Terminal-Debug": encodeDebugHeader({
              stage: "execute",
              url: executeUrl,
              input: raw,
              cwd: previousVirtualCwd,
            }),
          },
          body: JSON.stringify({ input: raw, cwd: previousVirtualCwd }),
        });

        let payload: ExecuteResponse | null = null;
        try {
          payload = await response.json();
        } catch (error) {
          // ignore JSON parse issues and fall back to generic message
          if (import.meta.env.DEV) {
            console.warn("terminal-service.execute_json_parse_failed", { error });
          }
        }

        const nextVirtual = payload?.cwd ?? previousVirtualCwd;
        const nextDisplay = payload?.displayCwd ?? toDisplayPath(nextVirtual);
        const isError = Boolean(payload?.error) || !response.ok;
        let output: string[] = Array.isArray(payload?.output)
          ? (payload?.output as string[])
          : [];
        if ((!payload || output.length === 0) && !response.ok) {
          if (import.meta.env.DEV) {
            console.error("terminal-service.execute_error", {
              status: response.status,
              payload,
            });
          }
          output = [`Command service returned status ${response.status}`];
        }

        const entry: HistoryEntry = {
          id: commandId.current++,
          cwd: previousDisplayCwd,
          command: raw,
          output,
          isError,
        };

        if (payload?.clear) {
          setHistory([]);
        } else {
          setHistory((prev) => [...prev, entry]);
        }

        setVirtualCwd(nextVirtual);
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error("terminal-service.execute_request_failed", { error });
        }
        const entry: HistoryEntry = {
          id: commandId.current++,
          cwd: previousDisplayCwd,
          command: raw,
          output: ["Failed to reach sandbox service. Please try again later."],
          isError: true,
        };
        setHistory((prev) => [...prev, entry]);
      } finally {
        setIsSubmitting(false);
        setInput("");
      }
    },
    [displayCwd, virtualCwd, connectionError, navigate],
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!input.trim() || loading || isSubmitting) {
        return;
      }
      runCommand(input);
    },
    [input, runCommand, loading, isSubmitting],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHistoryIndex((prev) => {
          if (!commandHistory.length) return null;
          const nextIndex = prev === null ? commandHistory.length - 1 : Math.max(prev - 1, 0);
          setInput(commandHistory[nextIndex] ?? "");
          return nextIndex;
        });
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setHistoryIndex((prev) => {
          if (prev === null) return null;
          const nextIndex = prev + 1;
          if (nextIndex >= commandHistory.length) {
            setInput("");
            return null;
          }
          setInput(commandHistory[nextIndex] ?? "");
          return nextIndex;
        });
      }
    },
    [commandHistory],
  );

  return {
    // State
    input,
    setInput,
    history,
    displayCwd,
    loading,
    connectionError,
    isSubmitting,
    // Computed
    bannerLines,
    bannerColor,
    // Handlers
    handleSubmit,
    handleKeyDown,
  };
}
function encodeDebugHeader(payload: Record<string, unknown>): string {
  try {
    return typeof btoa === "function" ? btoa(JSON.stringify(payload)) : JSON.stringify(payload);
  } catch {
    return "<debug-serialization-failed>";
  }
}
