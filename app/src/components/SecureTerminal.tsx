import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

const API_BASE = import.meta.env.VITE_TERMINAL_API_BASE ?? "/api/terminal";

const toDisplayPath = (virtualPath: string | undefined | null): string => {
  if (!virtualPath || virtualPath === "/") return "~";
  if (virtualPath === "/home/demo") return "~";
  if (virtualPath.startsWith("/home/demo/")) {
    return `~${virtualPath.slice("/home/demo".length)}`;
  }
  return virtualPath;
};

const SecureTerminal = () => {
  const [virtualCwd, setVirtualCwd] = useState<string>("/home/demo");
  const [displayCwd, setDisplayCwd] = useState<string>("~");
  const [input, setInput] = useState<string>("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [supportedCommands, setSupportedCommands] = useState<string[]>([]);
  const [motd, setMotd] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandId = useRef(0);

  useEffect(() => {
    const focusInput = () => {
      inputRef.current?.focus();
    };
    focusInput();
    window.addEventListener("click", focusInput);
    return () => window.removeEventListener("click", focusInput);
  }, []);

  useEffect(() => {
    const node = terminalRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [history, loading, connectionError]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const response = await fetch(`${API_BASE}/info`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        if (!response.ok) {
          throw new Error(`status ${response.status}`);
        }

        const payload = await response.json();
        if (cancelled) return;

        const nextVirtual = typeof payload.virtualCwd === "string"
          ? payload.virtualCwd
          : "/home/demo";
        const nextDisplay = typeof payload.displayCwd === "string"
          ? payload.displayCwd
          : toDisplayPath(nextVirtual);

        setVirtualCwd(nextVirtual);
        setDisplayCwd(nextDisplay);
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

  const bannerLines = useMemo(() => {
    if (loading) {
      return ["Establishing secure connection to sandbox pod..."];
    }
    if (connectionError) {
      return [connectionError];
    }
    const lines = [
      "Connected to isolated sandbox pod. Commands run inside a locked-down container.",
    ];
    if (supportedCommands.length) {
      lines.push(`Allowed commands: ${supportedCommands.join(", ")}`);
    }
    if (motd.length) {
      lines.push("---- motd ----", ...motd, "--------------");
    }
    return lines;
  }, [loading, connectionError, supportedCommands, motd]);

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

      try {
        setIsSubmitting(true);
        const response = await fetch(`${API_BASE}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: raw, cwd: previousVirtualCwd }),
        });

        let payload: ExecuteResponse | null = null;
        try {
          payload = await response.json();
        } catch (error) {
          // ignore JSON parse issues and fall back to generic message
        }

        const nextVirtual = payload?.cwd ?? previousVirtualCwd;
        const nextDisplay = payload?.displayCwd ?? toDisplayPath(nextVirtual);
        const isError = Boolean(payload?.error) || !response.ok;
        let output: string[] = Array.isArray(payload?.output)
          ? (payload?.output as string[])
          : [];
        if ((!payload || output.length === 0) && !response.ok) {
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
        setDisplayCwd(nextDisplay);
      } catch (error) {
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
    [displayCwd, virtualCwd],
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!input.trim() || loading || isSubmitting || connectionError) {
        return;
      }
      runCommand(input);
    },
    [input, runCommand, loading, isSubmitting, connectionError],
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

  const bannerColor = connectionError ? "text-terminal-red" : "text-terminal-cyan";

  return (
    <div
      className="w-full max-w-4xl mx-auto bg-black border-2 border-terminal-green font-mono shadow-[0_0_30px_rgba(0,255,0,0.25)]"
      role="region"
      aria-label="Sandbox terminal"
    >
      <div className="flex items-center gap-2 border-b-2 border-terminal-green px-3 py-2 text-xs sm:text-sm text-terminal-white">
        <span className="text-terminal-red">●</span>
        <span className="text-terminal-yellow">●</span>
        <span className="text-terminal-green">●</span>
        <span className="ml-3 text-terminal-cyan truncate">
          sandbox@gitgud.qzz.io:{displayCwd} — isolated pod
        </span>
      </div>

      <div
        ref={terminalRef}
        className="h-[60vh] sm:h-[70vh] overflow-y-auto px-3 py-4 text-xs sm:text-sm text-terminal-white"
      >
        {bannerLines.map((line, index) => (
          <p key={`banner-${index}`} className={bannerColor}>
            {line}
          </p>
        ))}
        {history.map((entry) => (
          <div key={entry.id} className="mt-3">
            <div className="flex flex-wrap gap-x-1">
              <span className="text-terminal-green">sandbox</span>
              <span className="text-terminal-white">:</span>
              <span className="text-terminal-cyan">{entry.cwd}</span>
              <span className="text-terminal-white">$</span>
              <span className="text-terminal-yellow">{entry.command}</span>
            </div>
            <div className="mt-1 space-y-1">
              {entry.output.length ? (
                entry.output.map((line, index) => (
                  <p
                    key={`${entry.id}-${index}`}
                    className={entry.isError ? "text-terminal-red" : "text-terminal-white"}
                  >
                    {line}
                  </p>
                ))
              ) : (
                <p className="text-terminal-white">&nbsp;</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t-2 border-terminal-green px-3 py-2 text-terminal-white"
      >
        <label htmlFor="secure-terminal-input" className="sr-only">
          Terminal input
        </label>
        <div className="flex items-center gap-1 text-xs sm:text-sm">
          <span className="text-terminal-green">sandbox</span>
          <span className="text-terminal-white">:</span>
          <span className="text-terminal-cyan">{displayCwd}</span>
          <span className="text-terminal-white">$</span>
        </div>
        <input
          ref={inputRef}
          id="secure-terminal-input"
          className="flex-1 bg-transparent text-terminal-yellow focus:outline-none caret-terminal-green"
          autoComplete="off"
          spellCheck={false}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Sandbox terminal input"
          disabled={loading || Boolean(connectionError) || isSubmitting}
        />
      </form>
    </div>
  );
};

export default SecureTerminal;
